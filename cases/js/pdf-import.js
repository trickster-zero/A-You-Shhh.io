// PDF import: loads pdf.js (pinned, from cdnjs), extracts text items with x/y per page,
// rebuilds reading order for two-column pages, and strips running headers, footers and page numbers.
// The layout functions are pure (no DOM) so the tests can run them in Node.
// Nothing here uploads anything: the file is read in the browser and kept on this device.

export const PDFJS_VERSION = '3.11.174';
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

/* ======================= Pure layout (Node-safe) ======================= */

const GUIDANCE_RE = /^(answer|answers|hints?|transition|solution|figures|interviewer notes?|notes? (to|for) (the )?interviewer)\b/i;
const PAGE_NO_RE = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

/**
 * layoutPage(raw, { sideColumn })
 * raw: { page, width, height, items: [{ str, x, y, w, h }] }  (y = text baseline, measured from the top)
 * sideColumn: 'auto' | 'left' | 'right' | 'none'
 * Returns { page, width, height, columns, lines: [{ text, col: 'main' | 'side', x, y, size }] } in reading order.
 */
export function layoutPage(raw, { sideColumn = 'auto', gutter: forced = null } = {}) {
  const W = raw.width, H = raw.height;
  const items = (raw.items || [])
    .filter(it => it && typeof it.str === 'string' && it.str.trim())
    .map(it => ({ str: it.str, x: +it.x, y: +it.y, w: Math.max(0, +it.w || 0), h: Math.max(1, +it.h || 10) }));
  const body = items.filter(it => it.y > H * 0.07 && it.y < H * 0.93);
  const gutter = findGutter(body, W) || (forced && fitsGutter(body, forced) ? forced : null);

  if (!gutter) {
    return { page: raw.page, width: W, height: H, columns: null, lines: groupLines(items).map(l => ({ ...l, col: 'main' })) };
  }

  const left = [], right = [], full = [];
  for (const it of items) {
    if (it.x + it.w <= gutter.g1 + 2) left.push(it);
    else if (it.x >= gutter.g0 - 2) right.push(it);
    else full.push(it);
  }
  const L = groupLines(left), R = groupLines(right), F = groupLines(full);
  const side = chooseSide(L, R, left, right, sideColumn);

  let lines;
  if (side) {
    // Guidance column kept separate: lines interleaved by height, each tagged with its column.
    lines = [
      ...L.map(l => ({ ...l, col: side === 'left' ? 'side' : 'main' })),
      ...R.map(l => ({ ...l, col: side === 'right' ? 'side' : 'main' })),
      ...F.map(l => ({ ...l, col: 'main' }))
    ].sort((a, b) => a.y - b.y || a.x - b.x);
  } else {
    // Ordinary two-column flow: within each band between full-width lines, left column then right column.
    lines = [];
    const cuts = [...F].sort((a, b) => a.y - b.y);
    let top = -Infinity;
    for (const cut of [...cuts, { y: Infinity }]) {
      const inBand = l => l.y > top && l.y <= cut.y;
      lines.push(...L.filter(inBand).map(l => ({ ...l, col: 'main' })));
      lines.push(...R.filter(inBand).map(l => ({ ...l, col: 'main' })));
      if (cut.text) lines.push({ ...cut, col: 'main' });
      top = cut.y;
    }
  }
  return { page: raw.page, width: W, height: H, columns: { gutter: [gutter.g0, gutter.g1], side: side || 'none' }, lines };
}

/** Finds an empty vertical strip in the middle of the page that splits it into two columns. */
export function findGutter(items, W) {
  if (items.length < 6 || !(W > 0)) return null;
  const size = Math.ceil(W) + 1;
  const cover = new Uint16Array(size);
  for (const it of items) {
    const a = Math.max(0, Math.floor(it.x)), b = Math.min(size - 1, Math.ceil(it.x + it.w));
    for (let x = a; x <= b; x++) cover[x]++;
  }
  const lo = Math.floor(W * 0.2), hi = Math.ceil(W * 0.8);
  const limit = Math.max(1, Math.floor(items.length * 0.04));      // a few full-width headings may cross it
  let best = null, start = -1;
  for (let x = lo; x <= hi + 1; x++) {
    const open = x <= hi && cover[x] <= limit;
    if (open && start < 0) start = x;
    if (!open && start >= 0) {
      if (!best || x - start > best.g1 - best.g0) best = { g0: start, g1: x - 1 };
      start = -1;
    }
  }
  if (!best || best.g1 - best.g0 < Math.max(8, W * 0.015)) return null;
  const mid = (best.g0 + best.g1) / 2;
  const leftCount = items.filter(it => it.x + it.w / 2 < mid).length;
  const rightCount = items.length - leftCount;
  if (!leftCount || !rightCount || leftCount < items.length * 0.05 || rightCount < items.length * 0.05) return null;
  return best;
}

/** True when no body item crosses the strip and there is text on both sides of it. */
function fitsGutter(items, g) {
  let l = 0, r = 0;
  for (const it of items) {
    if (it.x + it.w <= g.g1 + 2) l++;
    else if (it.x >= g.g0 - 2) r++;
    else return false;
  }
  return l > 0 && r > 0;
}

/** Groups items into lines by baseline, then joins each line left to right. */
export function groupLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(cur.y - it.y) <= Math.max(2, 0.45 * Math.min(cur.h, it.h))) cur.items.push(it);
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  return lines.map(l => {
    const parts = l.items.sort((a, b) => a.x - b.x);
    let text = '', end = null;
    for (const it of parts) {
      if (end !== null && it.x - end > it.h * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x: Math.min(...parts.map(p => p.x)),
      y: parts.reduce((s, p) => s + p.y, 0) / parts.length,
      size: Math.max(...parts.map(p => p.h))
    };
  }).filter(l => l.text);
}

function chooseSide(L, R, leftItems, rightItems, pref) {
  if (pref === 'left' || pref === 'right') return pref;
  if (pref === 'none') return null;
  const g = lines => lines.filter(l => GUIDANCE_RE.test(l.text)).length;
  const gl = g(L), gr = g(R);
  if (gl !== gr) return gl > gr ? 'left' : 'right';
  const width = its => its.length ? Math.max(...its.map(i => i.x + i.w)) - Math.min(...its.map(i => i.x)) : 0;
  const wl = width(leftItems), wr = width(rightItems);
  if (wl && wr && wl < wr * 0.85) return 'left';
  if (wl && wr && wr < wl * 0.85) return 'right';
  return null;
}

/**
 * Removes running headers, footers and page numbers.
 * A line in the top 8% or bottom 7% of a page goes if it is a bare page number, if the same text
 * (digits ignored) sits in that band on at least 40% of pages, or if it repeats the band text of the page before.
 */
export function stripRunning(pages) {
  const norm = t => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const inBand = (l, p) => l.y < p.height * 0.08 || l.y > p.height * 0.93;
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set(p.lines.filter(l => inBand(l, p)).map(l => norm(l.text)));
    for (const k of seen) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const min = Math.max(2, Math.ceil(pages.length * 0.4));
  let prevBand = new Set();
  return pages.map(p => {
    const band = new Set(p.lines.filter(l => inBand(l, p)).map(l => norm(l.text)));
    const lines = p.lines.filter(l => {
      if (!inBand(l, p)) return true;
      const k = norm(l.text);
      if (PAGE_NO_RE.test(l.text.trim())) return false;
      if (pages.length > 1 && (counts.get(k) || 0) >= min) return false;
      if (prevBand.has(k)) return false;                       // case-level running header: keep only the first
      return true;
    });
    prevBand = band;
    return { ...p, lines };
  });
}

/** Raw pages from readPdf() -> laid-out, cleaned pages ready for the parser. */
export function buildPages(rawPages, opts = {}) {
  const first = rawPages.map(p => layoutPage(p, opts));
  // Casebooks keep the same column layout throughout. Pages too sparse to show a gutter on their own
  // (one line in a column, say) reuse the gutter most pages agree on, if nothing on the page crosses it.
  const found = first.filter(p => p.columns).map(p => p.columns.gutter);
  if (!found.length || found.length === first.length) return stripRunning(first);
  const mid = arr => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const gutter = { g0: mid(found.map(g => g[0])), g1: mid(found.map(g => g[1])) };
  return stripRunning(first.map((p, i) => p.columns ? p : layoutPage(rawPages[i], { ...opts, gutter })));
}

/** Short, stable id for an imported file (name, size, page count). */
export function sourceIdFor(name, size, numPages) {
  return 'pdf-' + fnv(`${name}|${size}|${numPages}`);
}

export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ======================= Browser only ======================= */

let loading = null;
export function loadPdfJs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${CDN}/pdf.min.js`;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      const lib = globalThis.pdfjsLib;
      if (!lib) { loading = null; return reject(new Error('pdf.js loaded, but pdfjsLib is missing.')); }
      lib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`;
      resolve(lib);
    };
    s.onerror = () => { loading = null; reject(new Error('Could not load pdf.js from cdnjs. Check your connection and try again.')); };
    document.head.append(s);
  });
  return loading;
}

/** Reads a PDF File in the browser. Returns { bytes, numPages, pages: raw pages for buildPages }. */
export async function readPdf(file, { onProgress } = {}) {
  const lib = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      items.push({ str: it.str, x, y, w: it.width, h });
    }
    pages.push({ page: n, width: vp.width, height: vp.height, items });
    page.cleanup();
    onProgress?.(n, doc.numPages);
  }
  await doc.destroy();
  return { bytes, numPages: pages.length, pages };
}

const docCache = new Map();
export async function openPdf(sourceId, bytes) {
  if (docCache.has(sourceId)) return docCache.get(sourceId);
  const lib = await loadPdfJs();
  const p = lib.getDocument({ data: bytes.slice() }).promise;
  docCache.set(sourceId, p);
  return p;
}

/** Renders one page to an image URL (JPEG), sized to maxWidth CSS pixels. */
export async function renderPageImage(doc, pageNo, maxWidth = 900) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, (maxWidth * (globalThis.devicePixelRatio || 1)) / base.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  page.cleanup();
  return canvas.toDataURL('image/jpeg', 0.88);
}

/* The original PDF is kept in IndexedDB on this device so exhibit pages can be shown later. */
const DB = 'case-practice-pdfs', STORE = 'files';
function idb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB is not available.'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}
export const rememberPdf = (id, bytes) => tx('readwrite', s => s.put(bytes, id)).catch(() => null);
export const recallPdf = id => tx('readonly', s => s.get(id)).catch(() => null);
export const forgetPdfs = () => { docCache.clear(); return tx('readwrite', s => s.clear()).catch(() => null); };
