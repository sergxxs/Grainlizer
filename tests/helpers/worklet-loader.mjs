/* Test helper: load AudioWorklet processor files in a Node vm sandbox. */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadWorklet(relPath, { sampleRate = 48000 } = {}) {
  const file = path.join(ROOT, relPath);
  const code = fs.readFileSync(file, 'utf8');
  let ProcessorClass = null;
  const posted = [];

  class FakePort {
    constructor() {
      this.onmessage = null;
    }
    postMessage(msg, transfers) {
      // emulate structured clone of Float32Array payloads
      const copy = { ...msg };
      for (const key of Object.keys(copy)) {
        if (copy[key] instanceof Float32Array) copy[key] = copy[key].slice();
      }
      posted.push(copy);
    }
  }

  class AudioWorkletProcessor {
    constructor() {
      this.port = new FakePort();
    }
  }

  const sandbox = {
    sampleRate,
    registerProcessor: (name, cls) => { ProcessorClass = cls; },
    AudioWorkletProcessor,
    console,
    Math,
    Float32Array,
    Number,
    Object,
    Array
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  if (!ProcessorClass) throw new Error(`registerProcessor not called in ${relPath}`);
  return { ProcessorClass, posted, sampleRate };
}

export function makeOutput(channels = 2, frames = 128) {
  const chans = [];
  for (let i = 0; i < channels; i++) chans.push(new Float32Array(frames));
  return [chans];
}

export function makeInput(channels = 2, frames = 128, fill = 0) {
  const chans = [];
  for (let i = 0; i < channels; i++) {
    const a = new Float32Array(frames);
    if (fill) a.fill(fill);
    chans.push(a);
  }
  return [chans];
}
