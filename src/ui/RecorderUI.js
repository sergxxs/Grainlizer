/* GRAINLIZER — recorder / transport UI.
 * REC / STOP / EXPORT WAV buttons, MM:SS.ms timer, tail countdown, formats,
 * status line and error reporting. The UI stays predictable during export.
 */

'use strict';

export class RecorderUI {
  constructor(recorder, exporter, els) {
    this.recorder = recorder;
    this.exporter = exporter;
    this.els = els;
    this.bitDepth = 16;
    this.onStateChange = null;
    this.onTransportStop = null;
    this.onRecStart = null;
    this.hasTransport = true; // STOP also acts as transport stop

    this.recorder.onChange = (state) => this.renderState(state);
    this.recorder.onTick = ({ elapsed, tailRemaining, maxedOut }) => {
      this.renderTimer(elapsed, tailRemaining);
      if (maxedOut) this.setStatus('Достигнут лимит 20 минут — запись завершается…', 'warn');
    };

    els.btnRec.addEventListener('click', () => this.handleRec());
    els.btnStop.addEventListener('click', () => this.handleStop());
    els.btnExport.addEventListener('click', () => this.handleExport());

    if (els.tailSelect) {
      els.tailSelect.addEventListener('change', () => {
        this.recorder.tailSeconds = parseInt(els.tailSelect.value, 10) || 0;
      });
    }
    if (els.formatSelect) {
      els.formatSelect.addEventListener('change', () => {
        this.bitDepth = els.formatSelect.value === '32' ? 32 : 16;
      });
    }

    this.renderState('idle');
    this.renderTimer(0, 0);
  }

  async handleRec() {
    if (this.recorder.recording || this.recorder.state === 'finalizing') return;
    if (this.recorder.result) {
      // new take: drop previous result + cached blob
      this.recorder.discard();
      this.exporter.release();
    }
    try {
      await this.recorder.start();
      this.setStatus('Запись мастер-сигнала…', 'rec');
      if (this.onRecStart) this.onRecStart();
    } catch (err) {
      this.setStatus(String(err.message || err), 'error');
    }
  }

  handleStop() {
    if (this.recorder.state === 'recording') {
      this.recorder.stop();
      this.setStatus(`Хвост эффектов ${this.recorder.tailSeconds}s… (STOP — завершить сейчас)`, 'warn');
    } else if (this.recorder.state === 'tail') {
      this.recorder.stop();
    } else {
      // STOP also acts as transport stop when not recording
      if (this.onTransportStop) this.onTransportStop();
    }
  }

  async handleExport() {
    const r = this.recorder;
    if (r.recording || r.state === 'finalizing') {
      this.setStatus('Сначала дождитесь окончания записи', 'warn');
      return;
    }
    if (!r.result) {
      this.setStatus('Нет готовой записи — нажмите REC', 'warn');
      return;
    }
    const btn = this.els.btnExport;
    btn.disabled = true;
    try {
      this.setStatus('Экспорт WAV…', 'busy');
      const name = await this.exporter.exportResult(r.result, this.bitDepth);
      this.setStatus(`WAV готов: ${name} (${fmtBytes(this.exporter.lastBlob.size)})`, 'ok');
    } catch (err) {
      this.setStatus(`Ошибка экспорта: ${String(err.message || err)}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  renderState(state) {
    const { btnRec, btnStop, btnExport, recLed, recStatus } = this.els;
    const recording = state === 'recording';
    const tailing = state === 'tail';
    const busy = state === 'finalizing';

    btnRec.classList.toggle('is-recording', recording || tailing);
    btnRec.setAttribute('aria-pressed', recording || tailing ? 'true' : 'false');
    recLed.classList.toggle('is-on', recording || tailing);
    recLed.classList.toggle('is-tail', tailing);

    btnStop.disabled = !(recording || tailing) && !this.hasTransport;
    btnExport.disabled = state !== 'ready' || busy;
    btnExport.classList.toggle('is-ready', state === 'ready' && !busy);

    if (state === 'recording') this.setStatus('● REC — запись мастер-сигнала', 'rec');
    else if (state === 'tail') this.setStatus('Хвост эффектов…', 'warn');
    else if (state === 'finalizing') this.setStatus('Подготовка файла…', 'busy');
    else if (state === 'ready') {
      const d = this.recorder.result ? this.recorder.result.durationSec : 0;
      this.setStatus(`Готово: ${fmtDuration(d)} — можно экспортировать`, 'ok');
      this.renderTimer(0, 0, d);
    } else if (state === 'error') {
      this.setStatus(this.recorder.error || 'Ошибка записи', 'error');
    } else {
      this.setStatus('Готов к записи', 'idle');
    }
    if (this.onStateChange) this.onStateChange(state);
    if (recStatus) recStatus.dataset.state = state;
  }

  renderTimer(elapsed, tailRemaining, total) {
    const el = this.els.timer;
    if (!el) return;
    if (this.recorder.state === 'ready' && total !== undefined) {
      el.textContent = fmtDuration(total);
      el.classList.remove('is-live');
      return;
    }
    if (this.recorder.recording) {
      el.textContent = fmtDuration(elapsed);
      el.classList.add('is-live');
    } else {
      el.textContent = fmtDuration(0);
      el.classList.remove('is-live');
    }
    const tailEl = this.els.tailTimer;
    if (tailEl) {
      tailEl.textContent = this.recorder.state === 'tail' ? `TAIL ${tailRemaining.toFixed(1)}s` : '';
    }
  }

  setStatus(text, kind = 'idle') {
    const el = this.els.recStatus;
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
  }
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
