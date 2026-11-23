// localStorage for the case library, per-case tags, progress and settings. Everything stays on this device.
// Pass a storage object to createStore() for tests; it defaults to localStorage, or memory if that's blocked.

const KEYS = {
  library: 'case-practice:library:v1',
  tags: 'case-practice:tags:v1',
  progress: 'case-practice:progress:v1',
  settings: 'case-practice:settings:v1'
};
export const EXPORT_FORMAT = 'case-practice-progress';

export function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls) { ls.setItem('case-practice:probe', '1'); ls.removeItem('case-practice:probe'); return ls; }
  } catch { /* blocked */ }
  return memoryStorage();
}

export function createStore(storage = defaultStorage()) {
  const read = (k, fallback) => { try { const v = storage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const write = (k, v) => {
    try { storage.setItem(k, JSON.stringify(v)); return true; }
    catch (err) { throw new Error(err?.name === 'QuotaExceededError' ? 'This browser is out of storage space for cases. Remove some cases and try again.' : String(err?.message || err)); }
  };

  return {
    /* library */
    library: () => read(KEYS.library, []),
    getCase: id => read(KEYS.library, []).find(c => c.id === id) || null,
    saveCases(cases) {
      const lib = read(KEYS.library, []);
      const byId = new Map(lib.map(c => [c.id, c]));
      for (const c of cases) byId.set(c.id, c);
      write(KEYS.library, [...byId.values()]);
      return byId.size;
    },
    removeCase(id) { write(KEYS.library, read(KEYS.library, []).filter(c => c.id !== id)); },

    /* tags */
    tags: id => read(KEYS.tags, {})[id] || {},
    setTags(id, tags) { const all = read(KEYS.tags, {}); all[id] = { ...(all[id] || {}), ...tags }; write(KEYS.tags, all); },

    /* progress */
    progress: () => read(KEYS.progress, {}),
    recordAttempt(id, attempt) {
      const all = read(KEYS.progress, {});
      const p = all[id] || { attempts: [] };
      p.attempts.push(cleanAttempt(attempt));
      all[id] = p;
      write(KEYS.progress, all);
    },
    exportProgress: (at = new Date().toISOString()) => buildProgressExport(read(KEYS.progress, {}), at),
    importProgress(data) {
      const incoming = parseProgressExport(data);
      const all = read(KEYS.progress, {});
      let added = 0;
      for (const [id, attempts] of incoming) {
        const p = all[id] || { attempts: [] };
        const seen = new Set(p.attempts.map(a => `${a.startedAt}|${a.finishedAt}|${a.status}`));
        for (const a of attempts) {
          const k = `${a.startedAt}|${a.finishedAt}|${a.status}`;
          if (!seen.has(k)) { p.attempts.push(a); seen.add(k); added++; }
        }
        all[id] = p;
      }
      write(KEYS.progress, all);
      return added;
    },

    /* settings */
    settings: () => ({ mode: 'practice', readAloud: true, rate: 1, sideColumn: 'auto', ...read(KEYS.settings, {}) }),
    setSettings(patch) { write(KEYS.settings, { ...read(KEYS.settings, {}), ...patch }); },

    clearAll() { for (const k of Object.values(KEYS)) storage.removeItem(k); }
  };
}

/* ---------- export: ids, status, scores, timestamps. Never case text. ---------- */
const STATUS = new Set(['completed', 'skipped']);
const RUBRIC_KEYS = ['structure', 'math', 'synthesis', 'communication'];
const iso = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const int = v => (Number.isFinite(+v) ? Math.max(0, Math.round(+v)) : 0);
const safeId = v => String(v).replace(/[^a-z0-9-]/gi, '').slice(0, 64);

export function cleanAttempt(a = {}) {
  const status = STATUS.has(a.status) ? a.status : 'completed';
  const s = a.score;
  return {
    status,
    startedAt: iso(a.startedAt),
    finishedAt: iso(a.finishedAt),
    score: status === 'completed' && s ? {
      points: int(s.points), max: int(s.max), pct: int(s.pct), frameworkHints: int(s.frameworkHints),
      questions: (Array.isArray(s.questions) ? s.questions : []).map(q => ({
        n: int(q.n), hints: int(q.hints), ...Object.fromEntries(RUBRIC_KEYS.map(k => [k, !!q[k]]))
      }))
    } : null
  };
}

export function buildProgressExport(progress, at) {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: iso(at),
    cases: Object.entries(progress || {}).map(([id, p]) => ({
      id: safeId(id),
      attempts: (p?.attempts || []).map(cleanAttempt)
    }))
  };
}

export function parseProgressExport(data) {
  const obj = typeof data === 'string' ? JSON.parse(data) : data;
  if (!obj || obj.format !== EXPORT_FORMAT || !Array.isArray(obj.cases)) throw new Error("This file isn't a case practice progress export.");
  return obj.cases.filter(c => c && c.id).map(c => [safeId(c.id), (c.attempts || []).map(cleanAttempt)]);
}
