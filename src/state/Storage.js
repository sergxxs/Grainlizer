/* GRAINLIZER — persistence.
 * localStorage: settings, UI prefs, user presets (small data).
 * IndexedDB: last sample (channel PCM + metadata) and full project snapshots.
 * Every operation is defensive: corrupted data, private-mode failures and quota
 * errors must never break the instrument.
 */

'use strict';

import { sanitizeParams } from './Presets.js';

const LS_KEY = 'grainlizer:v1';
const DB_NAME = 'grainlizer';
const DB_VERSION = 1;
const STORE_SAMPLES = 'samples';
const STORE_PROJECTS = 'projects';

function lsGet() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function lsSet(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    return false; // quota / private mode
  }
}

export const Storage = {
  loadSettings() {
    const d = lsGet();
    return {
      params: sanitizeParams(d.params),
      recorder: {
        tailSeconds: [0, 2, 5, 10].includes(d.recorder?.tailSeconds) ? d.recorder.tailSeconds : 2,
        bitDepth: d.recorder?.bitDepth === 32 ? 32 : 16
      },
      ui: {
        lastPreset: typeof d.ui?.lastPreset === 'string' ? d.ui.lastPreset : ''
      }
    };
  },

  saveSettings(settings) {
    const d = lsGet();
    d.params = settings.params;
    d.recorder = settings.recorder;
    d.ui = settings.ui;
    return lsSet(d);
  },

  saveParams(params) {
    const d = lsGet();
    d.params = params;
    return lsSet(d);
  },

  /* ---------------- user presets (localStorage) ---------------- */

  loadUserPresets() {
    const d = lsGet();
    const list = Array.isArray(d.userPresets) ? d.userPresets : [];
    return list.filter((p) => p && typeof p.name === 'string' && p.params)
      .map((p) => ({
        id: String(p.id || `user-${Date.now()}`),
        name: String(p.name).slice(0, 32),
        desc: String(p.desc || 'пользовательский'),
        params: sanitizeParams(p.params),
        user: true
      }));
  },

  saveUserPreset(preset) {
    const d = lsGet();
    const list = Array.isArray(d.userPresets) ? d.userPresets : [];
    const entry = {
      id: preset.id || `user-${Date.now().toString(36)}`,
      name: String(preset.name || 'USER').slice(0, 32),
      desc: 'пользовательский',
      params: preset.params,
      user: true
    };
    const idx = list.findIndex((p) => p.id === entry.id);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    d.userPresets = list.slice(-24); // bounded
    return lsSet(d) ? entry : null;
  },

  deleteUserPreset(id) {
    const d = lsGet();
    const list = Array.isArray(d.userPresets) ? d.userPresets : [];
    d.userPresets = list.filter((p) => p.id !== id);
    return lsSet(d);
  },

  /* ---------------- IndexedDB ---------------- */

  _openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SAMPLES)) db.createObjectStore(STORE_SAMPLES);
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  },

  async _idbPut(store, key, value) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const st = tx.objectStore(store);
      const req = st.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('IndexedDB put failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted (quota?)'));
    });
  },

  async _idbGet(store, key) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
    });
  },

  async _idbDelete(store, key) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
    });
  },

  /**
   * Persist the decoded sample as raw channel Float32 data.
   * Returns { ok, reason }. Never throws.
   */
  async saveSample(meta, channelData) {
    try {
      await this._idbPut(STORE_SAMPLES, 'last', {
        meta,
        channels: channelData,
        savedAt: Date.now()
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  },

  async loadSample() {
    try {
      const rec = await this._idbGet(STORE_SAMPLES, 'last');
      if (!rec || !rec.channels || !rec.meta) return null;
      return rec;
    } catch (_) {
      return null;
    }
  },

  async clearSample() {
    try {
      await this._idbDelete(STORE_SAMPLES, 'last');
      return true;
    } catch (_) {
      return false;
    }
  },

  /** Project = params + recorder settings + sample metadata (sample stored separately). */
  async saveProject(name, params, recorder, meta) {
    try {
      const id = `p-${Date.now().toString(36)}`;
      await this._idbPut(STORE_PROJECTS, id, {
        name: String(name || 'untitled').slice(0, 48),
        params,
        recorder,
        meta: meta ? { name: meta.name, duration: meta.duration, sampleRate: meta.sampleRate, channels: meta.channels } : null,
        savedAt: Date.now()
      });
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  },

  async listProjects() {
    try {
      const db = await this._openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECTS, 'readonly');
        const st = tx.objectStore(STORE_PROJECTS);
        const req = st.getAll();
        const keyReq = st.getAllKeys();
        req.onsuccess = () => {
          const keys = keyReq.result || [];
          const vals = req.result || [];
          resolve(vals.map((v, i) => ({ id: keys[i], ...v })));
        };
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      return [];
    }
  },

  async clearAll() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch (_) { /* ignore */ }
    try {
      await this._idbDelete(STORE_SAMPLES, 'last');
    } catch (_) { /* ignore */ }
  }
};
