/* GRAINLIZER — application bootstrap and UI wiring. */

'use strict';

import { AudioEngine } from './audio/AudioEngine.js';
import { Recorder } from './audio/Recorder.js';
import { ExportEngine } from './audio/ExportEngine.js';
import { Waveform } from './ui/Waveform.js';
import { Knob, Toggle, Meter } from './ui/Controls.js';
import { RecorderUI } from './ui/RecorderUI.js';
import { BUILTIN_PRESETS, randomizeParams, sanitizeParams } from './state/Presets.js';
import { Storage } from './state/Storage.js';

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) console.warn('missing element', id);
  return el;
};

const engine = new AudioEngine();
const exporter = new ExportEngine();
const recorder = new Recorder(engine);

let analyserL = null;
let analyserR = null;
let waveform = null;
let recorderUI = null;
let activePresetId = '';
let saveTimer = 0;
let memInterval = 0;

const knobs = new Map();
const toggles = {};

/* ================= boot ================= */

async function boot() {
  bindModals();
  bindSampleSection();
  bindTransport();
  bindPresets();
  bindSettings();
  bindKnobs();
  bindToggles();

  waveform = new Waveform($('waveform'), {
    onSeek: (x) => {
      engine.seek(x);
      const k = knobs.get('position');
      if (k) k.setSilent(x);
      $('headReadout').textContent = `POS ${x.toFixed(3)}`;
    },
    onSelection: (a, b) => {
      engine.setSelection(a, b);
      updateSelectionChip();
      if (engine.buffer) {
        waveform.setSelection(
          engine.selection.start / engine.buffer.length,
          engine.selection.end / engine.buffer.length
        );
      }
    }
  });

  const meterL = new Meter($('meterL'));
  const meterR = new Meter($('meterR'));

  recorderUI = new RecorderUI(recorder, exporter, {
    btnRec: $('btnRec'),
    btnStop: $('btnStop'),
    btnExport: $('btnExport'),
    recLed: $('recLed'),
    recStatus: $('recStatus'),
    timer: $('timer'),
    tailTimer: $('tailTimer'),
    tailSelect: $('tailSelect'),
    formatSelect: $('formatSelect')
  });
  recorderUI.hasTransport = true;
  recorderUI.onTransportStop = () => engine.stop(false);
  recorderUI.onRecStart = async () => {
    // REC implies the instrument must sound: start the engine if it is idle
    if (!engine.playing) {
      try {
        await ensureAudio();
        await engine.play();
      } catch (_) { /* sample error already surfaced via status */ }
    }
  };
  recorderUI.onStateChange = (state) => {
    if (waveform) waveform.setRecording(state === 'recording' || state === 'tail');
    if (state === 'ready' || state === 'idle' || state === 'error') updateMemEstimate(0);
    autosave();
  };

  engine.onStatus = (st) => {
    const total = engine.buffer ? engine.buffer.length : 1;
    const headNorm = Math.max(0, Math.min(1, st.head / total));
    if (waveform) waveform.setHead(headNorm);
    $('headReadout').textContent = `POS ${headNorm.toFixed(3)}`;
    $('voiceReadout').textContent = `VOICES ${st.voiceCount}`;
  };

  engine.onSampleLoaded = (meta) => {
    if (meta && engine.buffer) {
      if (waveform) waveform.setBuffer(engine.buffer);
      $('chipName').textContent = meta.name;
      $('chipDur').textContent = `${meta.duration.toFixed(2)} s`;
      $('chipSr').textContent = `${meta.sampleRate} Hz`;
      $('chipCh').textContent = `${meta.channels} ch`;
      $('chipName').classList.remove('chip-dim');
      updateSelectionChip();
    } else {
      if (waveform) waveform.clear();
      $('chipName').textContent = 'нет семпла';
      $('chipName').classList.add('chip-dim');
      $('chipDur').textContent = '—';
      $('chipSr').textContent = '—';
      $('chipCh').textContent = '—';
      $('chipSel').textContent = 'SEL —';
    }
  };

  // init audio (context starts suspended until a gesture on iOS)
  try {
    await engine.init();
    setEngineStatus(engine.state);
    setupMeters();
  } catch (err) {
    setEngineStatus('error');
    $('recStatus').textContent = `Ошибка аудио: ${err.message}`;
    $('recStatus').dataset.kind = 'error';
    return;
  }

  // restore settings
  const settings = Storage.loadSettings();
  applyParamsToUI(settings.params);
  if (settings.recorder) {
    recorder.tailSeconds = settings.recorder.tailSeconds;
    $('tailSelect').value = String(settings.recorder.tailSeconds);
    recorderUI.bitDepth = settings.recorder.bitDepth;
    $('formatSelect').value = String(settings.recorder.bitDepth);
  }

  // sample: restore saved one, otherwise generate the demo sample.
  // Never let this kill the boot — unlock handlers must always be registered.
  try {
    const saved = await Storage.loadSample().catch(() => null);
    if (saved && saved.channels && saved.channels[0] && saved.channels[0].length) {
      try {
        const buf = engine.ctx.createBuffer(
          saved.channels.length,
          saved.channels[0].length,
          saved.meta.sampleRate || engine.ctx.sampleRate
        );
        for (let i = 0; i < saved.channels.length; i++) buf.copyToChannel(saved.channels[i], i);
        engine.setBuffer(buf, saved.meta);
      } catch (_) {
        await engine.createDemoSample();
      }
    } else {
      await engine.createDemoSample();
    }
  } catch (err) {
    console.warn('sample setup failed', err);
    $('recStatus').textContent = `Семпл не загрузился: ${err.message || err} — нажмите DEMO`;
    $('recStatus').dataset.kind = 'error';
  }

  // first gesture resumes the AudioContext (iOS autoplay policy).
  // Retry on every interaction: iOS Safari can flip to 'interrupted' at any time.
  const unlock = async () => {
    const state = await engine.resume();
    setEngineStatus(state);
  };
  for (const evt of ['pointerdown', 'touchend', 'click', 'keydown']) {
    window.addEventListener(evt, unlock, { passive: true });
  }
  engine.onStateChange = (state) => setEngineStatus(state);

  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      // returning from background often leaves iOS in 'interrupted'
      const state = await engine.resume();
      setEngineStatus(state);
    } else if (recorder.recording && recorderUI) {
      recorderUI.setStatus('Внимание: iOS может приостановить аудио при блокировке экрана', 'warn');
    }
  });

  // meters + clip LED + memory estimate
  const buf = new Float32Array(1024);
  const tickMeters = () => {
    let pkL = 0, pkR = 0, rmsL = 0, rmsR = 0;
    if (analyserL && analyserR) {
      analyserL.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > pkL) pkL = v;
        rmsL += buf[i] * buf[i];
      }
      rmsL = Math.sqrt(rmsL / buf.length);
      analyserR.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > pkR) pkR = v;
        rmsR += buf[i] * buf[i];
      }
      rmsR = Math.sqrt(rmsR / buf.length);
    }
    meterL.push([[pkL, rmsL], [0, 0]]);
    meterR.push([[pkR, rmsR], [0, 0]]);
    $('clipLed').classList.toggle('is-on', pkL > 0.985 || pkR > 0.985);
    if (recorder.recording) updateMemEstimate((performance.now() - recorder.startedAt) / 1000);
    requestAnimationFrame(tickMeters);
  };
  tickMeters();

  memInterval = memInterval || 0;
  setInterval(() => {
    if (engine.ready) {
      setEngineStatus(engine.state);
      const el = $('ctxState');
      if (el) el.textContent = engine.state;
    }
  }, 2000);

  registerPWA();
}

function setEngineStatus(state) {
  const led = $('engineLed');
  const text = $('engineStatusText');
  const banner = $('audioBanner');
  const running = state === 'running';
  if (running) {
    led.classList.add('is-on');
    text.textContent = 'AUDIO: RUNNING';
    text.style.color = 'var(--teal)';
  } else if (state === 'suspended' || state === 'interrupted') {
    led.classList.remove('is-on');
    text.textContent = state === 'interrupted' ? 'AUDIO: INTERRUPTED' : 'AUDIO: TAP TO START';
    text.style.color = 'var(--warn)';
  } else {
    led.classList.remove('is-on');
    text.textContent = `AUDIO: ${String(state).toUpperCase()}`;
    text.style.color = 'var(--err)';
  }
  if (banner) {
    banner.hidden = running || !engine.ready;
    banner.textContent = state === 'interrupted'
      ? '⚠ AUDIO INTERRUPTED — КОСНИТЕСЬ ЭКРАНА'
      : '♪ КОСНИТЕСЬ ЭКРАНА ДЛЯ ЗАПУСКА ЗВУКА';
  }
  const ctxInfo = $('ctxInfo');
  if (ctxInfo && engine.ctx) {
    ctxInfo.textContent = 'Web Audio OK';
    $('ctxSr').textContent = `${engine.ctx.sampleRate} Hz`;
  }
}

function setupMeters() {
  if (!engine.effects) return;
  const ctx = engine.ctx;
  analyserL = ctx.createAnalyser();
  analyserR = ctx.createAnalyser();
  analyserL.fftSize = 2048;
  analyserR.fftSize = 2048;
  const splitter = ctx.createChannelSplitter(2);
  engine.effects.output.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
}

/* ================= knobs & toggles ================= */

const PARAM_DEFS = {
  position: { toEngine: (v) => v, toUi: (p) => p.position },
  grainSize: { toEngine: (v) => v, toUi: (p) => p.grainSize },
  density: { toEngine: (v) => v, toUi: (p) => p.density },
  spray: { toEngine: (v) => v / 100, toUi: (p) => p.spray * 100 },
  pitch: { toEngine: (v) => v, toUi: (p) => p.pitch },
  rate: { toEngine: (v) => v, toUi: (p) => p.rate },
  jitter: { toEngine: (v) => v / 100, toUi: (p) => p.jitter * 100 },
  mix: { toEngine: (v) => v / 100, toUi: (p) => p.mix * 100 },
  master: { toEngine: (v) => v / 100, toUi: (p) => p.master * 100 },
  'filter.cutoff': { fx: ['filter', 'cutoff'], toEngine: (v) => v, toUi: (p) => p.fx.filter.cutoff },
  'filter.q': { fx: ['filter', 'q'], toEngine: (v) => v, toUi: (p) => p.fx.filter.q },
  'tape.drive': { fx: ['tape', 'drive'], toEngine: (v) => v, toUi: (p) => p.fx.tape.drive },
  'tape.tone': { fx: ['tape', 'tone'], toEngine: (v) => v / 100, toUi: (p) => p.fx.tape.tone * 100 },
  'tape.wow': { fx: ['tape', 'wow'], toEngine: (v) => v / 100, toUi: (p) => p.fx.tape.wow * 100 },
  'delay.time': { fx: ['delay', 'time'], toEngine: (v) => v, toUi: (p) => p.fx.delay.time },
  'delay.feedback': { fx: ['delay', 'feedback'], toEngine: (v) => v / 100, toUi: (p) => p.fx.delay.feedback * 100 },
  'delay.mix': { fx: ['delay', 'mix'], toEngine: (v) => v / 100, toUi: (p) => p.fx.delay.mix * 100 },
  'reverb.size': { fx: ['reverb', 'size'], toEngine: (v) => v / 100, toUi: (p) => p.fx.reverb.size * 100 },
  'reverb.decay': { fx: ['reverb', 'decay'], toEngine: (v) => v / 100, toUi: (p) => p.fx.reverb.decay * 100 },
  'reverb.mix': { fx: ['reverb', 'mix'], toEngine: (v) => v / 100, toUi: (p) => p.fx.reverb.mix * 100 }
};

function bindKnobs() {
  document.querySelectorAll('.knob[data-param]').forEach((el) => {
    const key = el.dataset.param;
    const def = PARAM_DEFS[key];
    const knob = new Knob(el, (v) => {
      if (!def) return;
      const ev = def.toEngine(v);
      if (def.fx) engine.setFxParam(def.fx[0], def.fx[1], ev);
      else engine.setParam(key, ev);
      autosave();
    });
    knobs.set(key, knob);
  });
}

function bindToggles() {
  toggles.reverse = new Toggle($('tgReverse'), (v) => { engine.setParam('reverse', v); autosave(); });
  toggles.freeze = new Toggle($('tgFreeze'), (v) => { engine.setParam('freeze', v); autosave(); });
  toggles.fxBypass = new Toggle($('tgFxBypass'), (v) => { engine.setParam('fxBypass', v); autosave(); });
  toggles.filterOn = new Toggle($('tgFilter'), (v) => { engine.setFxParam('filter', 'on', v); autosave(); });
  toggles.tapeOn = new Toggle($('tgTape'), (v) => { engine.setFxParam('tape', 'on', v); autosave(); });
  toggles.delayOn = new Toggle($('tgDelay'), (v) => { engine.setFxParam('delay', 'on', v); autosave(); });
  toggles.reverbOn = new Toggle($('tgReverb'), (v) => { engine.setFxParam('reverb', 'on', v); autosave(); });

  $('segLP').addEventListener('click', () => {
    $('segLP').classList.add('is-on');
    $('segHP').classList.remove('is-on');
    engine.setFxParam('filter', 'type', 'lowpass');
    autosave();
  });
  $('segHP').addEventListener('click', () => {
    $('segHP').classList.add('is-on');
    $('segLP').classList.remove('is-on');
    engine.setFxParam('filter', 'type', 'highpass');
    autosave();
  });
}

function applyParamsToUI(params) {
  const p = sanitizeParams(params);
  for (const [key, def] of Object.entries(PARAM_DEFS)) {
    const knob = knobs.get(key);
    if (knob && def.toUi) knob.setSilent(def.toUi(p));
  }
  if (toggles.reverse) {
    toggles.reverse.set(p.reverse, true);
    toggles.freeze.set(p.freeze, true);
    toggles.fxBypass.set(p.fxBypass, true);
    toggles.filterOn.set(p.fx.filter.on, true);
    toggles.tapeOn.set(p.fx.tape.on, true);
    toggles.delayOn.set(p.fx.delay.on, true);
    toggles.reverbOn.set(p.fx.reverb.on, true);
    if (p.fx.filter.type === 'highpass') {
      $('segHP').classList.add('is-on');
      $('segLP').classList.remove('is-on');
    } else {
      $('segLP').classList.add('is-on');
      $('segHP').classList.remove('is-on');
    }
  }
  engine.params = p;
  engine.pushParams();
}

/* ================= sample section ================= */

function bindSampleSection() {
  const fileInput = $('fileInput');
  $('btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return; // user cancelled
    await loadSampleFile(file);
  });

  $('btnDemo').addEventListener('click', async () => {
    await ensureAudio();
    await engine.createDemoSample();
  });

  $('btnClearSample').addEventListener('click', () => {
    engine.clearSample();
    Storage.clearSample();
  });

  $('btnSelAll').addEventListener('click', () => {
    engine.setSelection(0, 1);
    updateSelectionChip();
    syncWaveSelection();
  });

  $('btnSelReset').addEventListener('click', () => {
    engine.setSelection(0.25, 0.75);
    updateSelectionChip();
    syncWaveSelection();
  });
}

function syncWaveSelection() {
  if (waveform && engine.buffer) {
    waveform.setSelection(
      engine.selection.start / engine.buffer.length,
      engine.selection.end / engine.buffer.length
    );
  }
}

async function loadSampleFile(file) {
  $('recStatus').textContent = 'Декодирование…';
  $('recStatus').dataset.kind = 'busy';
  try {
    await ensureAudio();
    const meta = await engine.loadFile(file);
    $('recStatus').textContent = `Семпл загружен: ${meta.name}`;
    $('recStatus').dataset.kind = 'ok';
    const chans = [];
    for (let i = 0; i < engine.buffer.numberOfChannels; i++) {
      chans.push(new Float32Array(engine.buffer.getChannelData(i)));
    }
    const res = await Storage.saveSample(meta, chans);
    if (!res.ok) {
      $('recStatus').textContent = `Семпл загружен (не сохранён в IndexedDB: ${res.reason})`;
    }
  } catch (err) {
    $('recStatus').textContent = String(err.message || err);
    $('recStatus').dataset.kind = 'error';
  }
}

function updateSelectionChip() {
  if (!engine.buffer) return;
  const a = engine.selection.start / engine.buffer.length;
  const b = engine.selection.end / engine.buffer.length;
  $('chipSel').textContent = `SEL ${(a * 100).toFixed(1)}–${(b * 100).toFixed(1)}%`;
}

async function ensureAudio() {
  if (!engine.ready) await engine.init();
  const state = await engine.resume();
  setEngineStatus(state);
}

function updateMemEstimate(seconds) {
  const est = recorder.memoryEstimateMB(Math.max(seconds, 0));
  const el = $('memEstimate');
  if (!el) return;
  if (seconds > 0) {
    el.textContent = `MEM ~${est.toFixed(0)} MB`;
    el.style.color = est > 250 ? 'var(--err)' : est > 120 ? 'var(--warn)' : 'var(--text-dim)';
  } else {
    el.textContent = '';
  }
}

/* ================= transport ================= */

function bindTransport() {
  $('btnPlay').addEventListener('click', async () => {
    try {
      await ensureAudio();
      await engine.play();
    } catch (err) {
      $('recStatus').textContent = String(err.message || err);
      $('recStatus').dataset.kind = 'error';
    }
  });
  // STOP button is owned exclusively by RecorderUI (REC tail logic + transport stop)
}

/* ================= presets ================= */

function bindPresets() {
  renderPresets();

  $('btnRandomize').addEventListener('click', () => {
    const p = randomizeParams();
    applyParamsToUI(p);
    activePresetId = '';
    renderPresets();
    autosave();
    $('recStatus').textContent = 'RANDOMIZE: новые настройки';
    $('recStatus').dataset.kind = 'ok';
  });

  $('btnSavePreset').addEventListener('click', () => {
    const name = prompt('Имя пресета:', 'MY PATCH');
    if (!name) return;
    const entry = Storage.saveUserPreset({
      id: `user-${Date.now().toString(36)}`,
      name,
      params: engine.params
    });
    if (entry) {
      renderPresets();
      $('settingsNote').textContent = `Пресет «${entry.name}» сохранён.`;
    } else {
      $('recStatus').textContent = 'Не удалось сохранить пресет (хранилище недоступно)';
      $('recStatus').dataset.kind = 'error';
    }
  });
}

function renderPresets() {
  const strip = $('presetStrip');
  strip.innerHTML = '';
  const user = Storage.loadUserPresets();
  const all = [...BUILTIN_PRESETS, ...user];
  for (const preset of all) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'preset-chip'
      + (preset.user ? ' preset-user' : '')
      + (preset.id === activePresetId ? ' is-active' : '');
    chip.innerHTML = `<span class="p-name">${escapeHtml(preset.name)}</span><span class="p-desc">${escapeHtml(preset.desc || '')}</span>`;
    chip.addEventListener('click', () => {
      applyParamsToUI(preset.params);
      activePresetId = preset.id;
      renderPresets();
      autosave();
    });
    if (preset.user) {
      const del = document.createElement('span');
      del.className = 'p-del';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        Storage.deleteUserPreset(preset.id);
        renderPresets();
      });
      chip.appendChild(del);
    }
    strip.appendChild(chip);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ================= settings / storage ================= */

function bindSettings() {
  $('btnSaveProject').addEventListener('click', async () => {
    const name = prompt('Имя проекта:', 'GRAINLIZER PROJECT');
    if (!name) return;
    const res = await Storage.saveProject(name, engine.params, {
      tailSeconds: recorder.tailSeconds,
      bitDepth: recorderUI ? recorderUI.bitDepth : 16
    }, engine.meta);
    $('settingsNote').textContent = res.ok
      ? `Проект «${name}» сохранён (настройки + метаданные семпла).`
      : `Ошибка сохранения: ${res.reason}`;
  });

  $('btnLoadProject').addEventListener('click', async () => {
    const projects = await Storage.listProjects();
    if (!projects.length) {
      $('settingsNote').textContent = 'Сохранённых проектов нет.';
      return;
    }
    const names = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    const answer = prompt(`Выберите проект (номер):\n${names}`, '1');
    const idx = parseInt(answer, 10) - 1;
    if (!(idx >= 0 && idx < projects.length)) return;
    const proj = projects[idx];
    applyParamsToUI(proj.params);
    if (proj.recorder) {
      recorder.tailSeconds = proj.recorder.tailSeconds ?? 2;
      $('tailSelect').value = String(recorder.tailSeconds);
    }
    $('settingsNote').textContent = `Проект «${proj.name}» загружен. Семпл: ${proj.meta ? proj.meta.name : 'загрузите вручную (или используйте последний сохранённый).'}`;
  });

  $('btnClearData').addEventListener('click', async () => {
    if (!confirm('Удалить все сохранённые настройки, пресеты и семплы?')) return;
    await Storage.clearAll();
    renderPresets();
    $('settingsNote').textContent = 'Все локальные данные удалены. Обновите страницу.';
    $('userPresetCount').textContent = '0';
  });

  setInterval(() => {
    const el = $('userPresetCount');
    if (el) el.textContent = String(Storage.loadUserPresets().length);
  }, 3000);
}

function autosave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Storage.saveSettings({
      params: engine.params,
      recorder: {
        tailSeconds: recorder.tailSeconds,
        bitDepth: recorderUI ? recorderUI.bitDepth : 16
      },
      ui: { lastPreset: activePresetId }
    });
  }, 400);
}

/* ================= modals ================= */

function bindModals() {
  $('btnHelp').addEventListener('click', () => openModal('helpModal'));
  $('btnSettings').addEventListener('click', () => openModal('settingsModal'));
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

/* ================= PWA ================= */

function registerPWA() {
  const isSecure = location.protocol === 'https:'
    || location.hostname === 'localhost'
    || location.hostname === '127.0.0.1'
    || location.hostname.endsWith('.e2b.app');
  if ('serviceWorker' in navigator && isSecure) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('SW registration failed', err);
    });
  }
}

boot().catch((err) => {
  console.error('boot failed', err);
  const el = document.getElementById('recStatus');
  if (el) {
    el.textContent = `Ошибка запуска: ${err && err.message ? err.message : err}`;
    el.dataset.kind = 'error';
  }
});
