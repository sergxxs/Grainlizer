/* GRAINLIZER — hardware-style controls.
 * Knobs (pointer-drag vertical), toggles, segmented selects and canvas meters.
 * Knob DOM contract:
 *   <div class="knob" data-param="grainSize" data-min="8" data-max="1500"
 *        data-step="1" data-default="180" data-unit="ms" data-label="SIZE">
 *     <div class="knob-dial"><div class="knob-pointer"></div></div>
 *     <div class="knob-value">…</div><div class="knob-label">…</div>
 *   </div>
 */

'use strict';

export class Knob {
  constructor(el, onChange) {
    this.el = el;
    this.dial = el.querySelector('.knob-dial');
    this.pointer = el.querySelector('.knob-pointer');
    this.valueEl = el.querySelector('.knob-value');
    this.min = parseFloat(el.dataset.min || '0');
    this.max = parseFloat(el.dataset.max || '1');
    this.step = parseFloat(el.dataset.step || '0');
    this.def = parseFloat(el.dataset.default || String((this.min + this.max) / 2));
    this.unit = el.dataset.unit || '';
    this.scale = el.dataset.scale === 'log' ? 'log' : 'lin';
    this.fmt = el.dataset.fmt || 'auto';
    this.value = this.def;
    this.onChange = onChange || (() => {});
    this._bind();
    this.render();
  }

  set(value, silent = false) {
    const v = this._quantize(Math.max(this.min, Math.min(this.max, value)));
    this.value = v;
    this.render();
    if (!silent) this.onChange(v);
  }

  setSilent(value) {
    this.set(value, true);
  }

  _quantize(v) {
    if (this.step > 0) return Math.round(v / this.step) * this.step;
    return v;
  }

  _norm() {
    if (this.scale === 'log') {
      const lo = Math.log(this.min);
      const hi = Math.log(this.max);
      return (Math.log(Math.max(this.min, this.value)) - lo) / (hi - lo);
    }
    return (this.value - this.min) / (this.max - this.min);
  }

  _fromNorm(n) {
    const t = Math.max(0, Math.min(1, n));
    if (this.scale === 'log') {
      const lo = Math.log(this.min);
      const hi = Math.log(this.max);
      return Math.exp(lo + t * (hi - lo));
    }
    return this.min + t * (this.max - this.min);
  }

  format() {
    const v = this.value;
    if (this.fmt === 'int') return `${Math.round(v)}${this.unit ? ' ' + this.unit : ''}`;
    if (this.fmt === 'fix1') return `${v.toFixed(1)}${this.unit ? ' ' + this.unit : ''}`;
    if (this.fmt === 'fix2') return `${v.toFixed(2)}${this.unit ? ' ' + this.unit : ''}`;
    if (this.fmt === 'sign1') return `${v > 0 ? '+' : ''}${v.toFixed(1)}${this.unit ? ' ' + this.unit : ''}`;
    if (Math.abs(v) >= 100) return `${Math.round(v)}${this.unit ? ' ' + this.unit : ''}`;
    if (Math.abs(v) >= 10) return `${v.toFixed(1)}${this.unit ? ' ' + this.unit : ''}`;
    return `${v.toFixed(2)}${this.unit ? ' ' + this.unit : ''}`;
  }

  render() {
    const angle = -135 + this._norm() * 270;
    if (this.pointer) this.pointer.style.transform = `rotate(${angle}deg)`;
    if (this.dial) this.dial.style.setProperty('--val', `${this._norm() * 100}%`);
    if (this.valueEl) this.valueEl.textContent = this.format();
    this.el.setAttribute('aria-valuenow', String(this.value));
    this.el.setAttribute('aria-valuetext', this.format());
  }

  _bind() {
    const el = this.el;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-valuemin', String(this.min));
    el.setAttribute('aria-valuemax', String(this.max));

    let dragging = false;
    let startY = 0;
    let startNorm = 0;
    let pointerId = null;
    let lastTap = 0;

    const begin = (clientY, id) => {
      dragging = true;
      startY = clientY;
      startNorm = this._norm();
      pointerId = id;
    };

    const update = (clientY) => {
      if (!dragging) return;
      const rect = el.getBoundingClientRect();
      const sensitivity = rect.height * 1.6 || 160;
      const fine = 0.25; // fine control always on touch: vertical drag
      const delta = (startY - clientY) / sensitivity * fine * (1 + 0);
      this.set(this._fromNorm(startNorm + delta));
    };

    el.addEventListener('pointerdown', (e) => {
      const now = performance.now();
      if (now - lastTap < 320) {
        this.set(this.def); // double tap = default
        dragging = false;
        lastTap = 0;
        return;
      }
      lastTap = now;
      el.setPointerCapture(e.pointerId);
      begin(e.clientY, e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (dragging && e.pointerId === pointerId) {
        update(e.clientY);
        e.preventDefault();
      }
    });
    const end = (e) => {
      if (e.pointerId === pointerId) {
        dragging = false;
        pointerId = null;
        try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const stepN = (e.deltaY < 0 ? 1 : -1) * (this.step > 0 ? this.step / (this.max - this.min) : 0.02);
      this.set(this._fromNorm(this._norm() + stepN));
    }, { passive: false });

    el.addEventListener('keydown', (e) => {
      const big = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        this.set(this._fromNorm(this._norm() + big));
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        this.set(this._fromNorm(this._norm() - big));
        e.preventDefault();
      } else if (e.key === 'Home') {
        this.set(this.def);
        e.preventDefault();
      }
    });
  }
}

export class Toggle {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange || (() => {});
    this.value = el.getAttribute('aria-pressed') === 'true';
    el.addEventListener('click', () => {
      this.set(!this.value);
    });
    this.render();
  }
  set(v, silent = false) {
    this.value = !!v;
    this.render();
    if (!silent) this.onChange(this.value);
  }
  render() {
    this.el.setAttribute('aria-pressed', this.value ? 'true' : 'false');
    this.el.classList.toggle('is-on', this.value);
  }
}

/** Peak + RMS meter (two channels) on a canvas. */
export class Meter {
  constructor(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.peaks = [0, 0];
    this.rms = [0, 0];
    this.hold = [0, 0];
    this.holdT = [0, 0];
    this._raf = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const loop = () => {
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const parent = this.canvas.parentElement;
    const w = Math.max(40, parent ? parent.clientWidth : 80);
    const h = Math.max(10, parent ? parent.clientHeight : 14);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    this.w = w;
    this.h = h;
  }
  push(values) {
    // values: [ [peakL, rmsL], [peakR, rmsR] ]
    for (let ch = 0; ch < 2; ch++) {
      const [pk, rms] = values[ch] || [0, 0];
      this.peaks[ch] = Math.max(this.peaks[ch] * 0.82, pk);
      this.rms[ch] += (Math.max(0, Math.min(1, rms)) - this.rms[ch]) * 0.35;
      if (pk >= this.hold[ch]) {
        this.hold[ch] = pk;
        this.holdT[ch] = 60;
      } else if (this.holdT[ch] > 0) {
        this.holdT[ch]--;
      } else {
        this.hold[ch] *= 0.97;
      }
    }
  }
  draw() {
    const c = this.c;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const barH = H / 2 - 1 * this.dpr;
    for (let ch = 0; ch < 2; ch++) {
      const y = ch * (barH + 2 * this.dpr);
      c.fillStyle = 'rgba(46,230,214,0.12)';
      c.fillRect(0, y, W, barH);
      const drawBar = (v, color, hFrac) => {
        const w = Math.max(0, Math.min(1, v)) * W;
        c.fillStyle = color;
        c.fillRect(0, y + barH * (1 - hFrac), w, barH * hFrac);
      };
      drawBar(this.rms[ch], '#19b8b0', 1);
      drawBar(this.peaks[ch] * 0.9, 'rgba(46,230,214,0.55)', 0.5);
      if (this.hold[ch] > 0.001) {
        const x = Math.min(W - 2, this.hold[ch] * W);
        c.fillStyle = this.hold[ch] > 0.95 ? '#ff409c' : '#eafffd';
        c.fillRect(x, y, 2 * this.dpr, barH);
      }
      // clip indicator zone
      c.fillStyle = 'rgba(255,64,156,0.25)';
      c.fillRect(W * 0.97, y, W * 0.03, barH);
    }
  }
}
