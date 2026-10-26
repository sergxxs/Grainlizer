/* GRAINLIZER — waveform display (Canvas).
 * Renders min/max peaks, selection range, playhead and grain-head position.
 * Touch: drag to scrub, drag edge handles to set the selection range.
 */

'use strict';

export class Waveform {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.buffer = null;
    this.peaks = null;          // Float32Array pairs min/max per column
    this.peakWidth = 0;
    this.selection = { start: 0, end: 1 }; // normalized 0..1
    this.head = 0;              // normalized playhead (from engine status)
    this.knobPosition = 0.35;   // normalized position knob
    this.recording = false;
    this.onSeek = opts.onSeek || null;
    this.onSelection = opts.onSelection || null;
    this._dragMode = null;      // 'seek' | 'selStart' | 'selEnd'
    this._raf = 0;
    this._dirty = true;

    this._bindPointer();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas.parentElement || canvas);
    this.resize();
    this._loop();
  }

  setBuffer(audioBuffer) {
    this.buffer = audioBuffer;
    this.computePeaks();
    this.selection = { start: 0, end: 1 };
    this.head = 0;
    this._dirty = true;
  }

  clear() {
    this.buffer = null;
    this.peaks = null;
    this._dirty = true;
  }

  setSelection(a, b) {
    this.selection = { start: Math.max(0, Math.min(1, a)), end: Math.max(0, Math.min(1, b)) };
    this._dirty = true;
  }

  setHead(n) {
    if (Math.abs(n - this.head) > 0.0005) {
      this.head = n;
      this._dirty = true;
    }
  }

  setKnobPosition(n) {
    this.knobPosition = n;
    this._dirty = true;
  }

  setRecording(on) {
    this.recording = !!on;
    this._dirty = true;
  }

  computePeaks() {
    const buf = this.buffer;
    if (!buf) { this.peaks = null; return; }
    const width = Math.max(64, this.cssWidth * 2);
    const ch = buf.getChannelData(0);
    const ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const n = ch.length;
    const peaks = new Float32Array(width * 2);
    const step = n / width;
    for (let x = 0; x < width; x++) {
      const start = Math.floor(x * step);
      const end = Math.min(n, Math.floor((x + 1) * step) + 1);
      let mn = 1, mx = -1;
      for (let i = start; i < end; i++) {
        let v = ch[i];
        if (ch2) v = (v + ch2[i]) * 0.5;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (end <= start) { mn = 0; mx = 0; }
      peaks[x * 2] = mn;
      peaks[x * 2 + 1] = mx;
    }
    this.peaks = peaks;
    this.peakWidth = width;
    this._dirty = true;
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(120, parent.clientWidth);
    const h = Math.max(80, parent.clientHeight);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cssWidth = w;
    this.cssHeight = h;
    this.dpr = dpr;
    if (this.buffer) this.computePeaks();
    this._dirty = true;
  }

  _loop() {
    const tick = () => {
      if (this._dirty) this.draw();
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  draw() {
    this._dirty = false;
    const c = this.ctx2d;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.dpr;

    c.clearRect(0, 0, W, H);

    // background grid
    c.fillStyle = '#070b0d';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(45, 212, 212, 0.10)';
    c.lineWidth = 1;
    for (let gx = 0; gx <= 8; gx++) {
      const x = Math.floor((gx / 8) * W) + 0.5;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
    }
    const mid = H / 2;
    c.beginPath(); c.moveTo(0, mid); c.lineTo(W, mid); c.stroke();

    // selection dimming (outside region)
    const selA = this.selection.start * W;
    const selB = this.selection.end * W;
    c.fillStyle = 'rgba(3, 6, 8, 0.62)';
    c.fillRect(0, 0, selA, H);
    c.fillRect(selB, 0, W - selB, H);

    // waveform
    if (this.peaks && this.peakWidth > 0) {
      const peaks = this.peaks;
      const n = this.peakWidth;
      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#2ee6d6');
      grad.addColorStop(0.5, '#19b8b0');
      grad.addColorStop(1, '#2ee6d6');
      c.fillStyle = grad;
      const barW = W / n;
      for (let x = 0; x < n; x++) {
        const mn = peaks[x * 2];
        const mx = peaks[x * 2 + 1];
        const y1 = mid - mx * mid * 0.92;
        const y2 = mid - mn * mid * 0.92;
        c.fillRect(x * barW, y1, Math.max(1, barW), Math.max(1, y2 - y1));
      }
    } else {
      c.fillStyle = 'rgba(46, 230, 214, 0.25)';
      c.font = `${11 * dpr}px monospace`;
      c.fillText('NO SAMPLE', 10 * dpr, mid);
    }

    // selection edges
    c.fillStyle = 'rgba(255, 64, 156, 0.85)';
    c.fillRect(selA - 1.5 * dpr, 0, 3 * dpr, H);
    c.fillRect(selB - 1.5 * dpr, 0, 3 * dpr, H);
    c.fillRect(selA - 6 * dpr, mid - 10 * dpr, 12 * dpr, 20 * dpr);
    c.fillRect(selB - 6 * dpr, mid - 10 * dpr, 12 * dpr, 20 * dpr);

    // position knob marker (diamond)
    const kx = this.knobPosition * W;
    c.fillStyle = 'rgba(255, 64, 156, 0.9)';
    c.beginPath();
    c.moveTo(kx, mid - 26 * dpr);
    c.lineTo(kx + 7 * dpr, mid - 18 * dpr);
    c.lineTo(kx, mid - 10 * dpr);
    c.lineTo(kx - 7 * dpr, mid - 18 * dpr);
    c.closePath();
    c.fill();

    // live head
    const hx = this.head * W;
    c.fillStyle = this.recording ? '#ff409c' : '#eafffd';
    c.fillRect(hx - 1 * dpr, 0, 2 * dpr, H);
    c.fillStyle = this.recording ? '#ff409c' : '#2ee6d6';
    c.fillRect(hx - 4 * dpr, H - 8 * dpr, 8 * dpr, 6 * dpr);
  }

  _bindPointer() {
    const el = this.canvas;
    const hitTest = (clientX) => {
      const rect = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const down = (e) => {
      el.setPointerCapture(e.pointerId);
      const x = hitTest(e.clientX);
      const sel = this.selection;
      const threshold = 0.035;
      if (Math.abs(x - sel.start) < threshold && sel.start < 0.5) {
        this._dragMode = 'selStart';
      } else if (Math.abs(x - sel.end) < threshold && sel.end > 0.5) {
        this._dragMode = 'selEnd';
      } else {
        this._dragMode = 'seek';
        if (this.onSeek) this.onSeek(x);
      }
      e.preventDefault();
    };

    const move = (e) => {
      if (!this._dragMode) return;
      const x = hitTest(e.clientX);
      if (this._dragMode === 'seek') {
        if (this.onSeek) this.onSeek(x);
      } else if (this._dragMode === 'selStart') {
        const end = this.selection.end;
        if (this.onSelection) this.onSelection(Math.min(x, end - 0.01), end);
      } else if (this._dragMode === 'selEnd') {
        const start = this.selection.start;
        if (this.onSelection) this.onSelection(start, Math.max(x, start + 0.01));
      }
      e.preventDefault();
    };

    const up = (e) => {
      this._dragMode = null;
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
