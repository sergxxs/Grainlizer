#!/usr/bin/env node
/* GRAINLIZER — PWA icon generator (no dependencies).
 * Rasterizes a simple branded icon into PNGs using node:zlib.
 * Icon: near-black rounded square, turquoise waveform/grain bars, pink accent.
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = size;
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };

  // background: near-black with subtle vertical gradient + rounded corners
  const radius = S * 0.18;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // rounded corner alpha
      const cx = x < radius ? radius : (x > S - radius ? S - radius : x);
      const cy = y < radius ? radius : (y > S - radius ? S - radius : y);
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue; // transparent corner
      const t = y / S;
      const r = Math.round(8 + t * 6);
      const g = Math.round(13 + t * 8);
      const b = Math.round(16 + t * 9);
      const edge = d > radius - 1.5 ? Math.max(0, Math.min(1, radius - d)) : 1;
      set(x, y, r, g, b, Math.round(255 * edge));
    }
  }

  // grain bars (turquoise waveform)
  const bars = 9;
  const mid = S * 0.52;
  for (let i = 0; i < bars; i++) {
    const fx = i / (bars - 1);
    const x = S * (0.16 + fx * 0.68);
    const wave = Math.sin(fx * Math.PI * 2.2) * 0.5 + 0.5;
    const h = S * (0.08 + wave * 0.34) * (0.65 + 0.35 * Math.sin(fx * Math.PI * 3 + 1.2));
    const bw = Math.max(2, S * 0.035);
    for (let dy = -h / 2; dy <= h / 2; dy += 0.5) {
      for (let dx = -bw / 2; dx <= bw / 2; dx += 0.5) {
        const px = Math.round(x + dx);
        const py = Math.round(mid + dy);
        const glow = 1 - Math.min(1, Math.abs(dx) / (bw / 2 + 0.01));
        const r = Math.round(46 * glow + 8 * (1 - glow));
        const g = Math.round(230 * glow + 20 * (1 - glow));
        const b = Math.round(214 * glow + 22 * (1 - glow));
        set(px, py, r, g, b);
        // soft glow
        if (Math.abs(dx) > bw / 2 - 1) set(px, py, 12, 60, 58, 120);
      }
    }
  }

  // pink accent: record dot + baseline
  const dotX = S * 0.82;
  const dotY = S * 0.2;
  const dotR = S * 0.075;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - dotX, y - dotY);
      if (d < dotR) set(x, y, 255, 64, 156);
      else if (d < dotR * 1.5) set(x, y, 180, 30, 100, Math.round(120 * (1 - (d - dotR) / (dotR * 0.5))));
    }
  }
  // baseline
  const by = Math.round(S * 0.78);
  for (let x = Math.round(S * 0.16); x < Math.round(S * 0.84); x++) {
    set(x, by, 46, 230, 214, 200);
    set(x, by + 1, 20, 120, 115, 130);
  }

  return rgba;
}

for (const size of [192, 512, 180]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  const png = encodePng(size, size, drawIcon(size));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), png);
  console.log('wrote', name, png.length, 'bytes');
}
