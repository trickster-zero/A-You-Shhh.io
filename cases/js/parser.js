// Parser: pure functions, no DOM. Turns laid-out pages (from pdf-import.js) into case objects.
// Headings are matched with the patterns in HEADINGS. If your casebook uses other words, edit them there.
// Missing required pieces become warnings. The parser never invents content.
import { fnv } from './pdf-import.js';

const head = words => new RegExp(`^(?:${words})\\s*(?:[:\\-–—]\\s*(.*))?$`, 'i');

export const HEADINGS = {
  caseStart: /^case\s*(?:#|no\.?)?\s*(\d{1,3})\s*(?:[:.\-–—|]\s*(.*))?$/i,
  subtitle: /^([^|]{2,60}?)\s*\|\s*([^|]{2,60})$/,
  question: /^question\s*(\d{1,2})\s*(?:[:.)\-–—]\s*(.*))?$/i,
  exhibit: /^exhibit\s*(\d{1,2})\s*(?:[:.\-–—]\s*(.*))?$/i,
  prompt: head('(?:case\\s+)?prompt|problem statement|case statement'),
  clarifying: head('clarifying (?:information|questions?|facts)'),
  behavioral: head('behaviou?ral(?: question)?|fit question'),
  frameworkHint: head('(?:suggested |possible |sample )?(?:framework|structure)'),
  answer: head('(?:sample )?answers?|solution'),
  hint: head('hints?'),
  figures: head('figures|data|numbers|given (?:on request|if asked)|information to (?:give|provide)'),
  transition: head('transition'),
  recap: head('recap|case recap|teaching(?: notes| section)?|key takeaways'),
  recommendation: head('(?:sample |final )?(?:recommendation|conclusion)s?')
};

const CASE_KINDS = ['prompt', 'clarifying', 'behavioral', 'frameworkHint', 'recap', 'recommendation'];
const QUESTION_KINDS = ['answer', 'hint', 'figures', 'transition'];
const BULLET = /^\s*(?:[•●▪◦‣\-–*]|\d{1,2}[.)])\s+(.*)$/;
const ROW = /^(.{1,60}?)\s*(?::|=|\s[–—-]\s)\s*(.+)$/;
const INLINE_EXHIBIT = /\bexhibit\s*(\d{1,2})\b/gi;

export function isTitleLine(t) {
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && t.length <= 80 && t === t.toUpperCase() && /[A-Z]/.test(t) && !isHeading(t);
}
function isHeading(t) {
  return HEADINGS.question.test(t) || HEADINGS.exhibit.test(t) || [...CASE_KINDS, ...QUESTION_KINDS].some(k => HEADINGS[k].test(t));
}

/**
 * parseCasebook(pages, { source }) -> { cases, warnings }
 * pages: output of buildPages(). source: { id, name } of the imported file.
 */
export function parseCasebook(pages, { source = { id: 'local', name: 'casebook.pdf' } } = {}) {
  const lines = [];
  for (const p of pages) for (const l of p.lines) lines.push({ text: l.text.trim(), col: l.col === 'side' ? 'side' : 'main', page: p.page, y: l.y, pageHeight: p.height });

  // Split into cases at "Case N" lines in the main column.
  const chunks = [];
  let cur = null;
  for (const ln of lines) {
    if (!ln.text) continue;
    const m = ln.col === 'main' && ln.text.length <= 90 ? HEADINGS.caseStart.exec(ln.text) : null;
    if (m) {
      const prev = cur?.lines[cur.lines.length - 1];
      const pre = prev && prev.page === ln.page && isTitleLine(prev.text) ? cur.lines.pop() : null;
      cur = { number: m[1], rest: (m[2] || '').trim(), pre, lines: [], page: ln.page };
      chunks.push(cur);
      continue;
    }
    if (!cur) { cur = { number: null, rest: '', pre: null, lines: [], page: ln.page }; chunks.push(cur); }
    cur.lines.push(ln);
  }
  // Front matter before the first numbered case is dropped when it holds no questions.
  const numbered = chunks.some(c => c.number);
  const kept = chunks.filter(c => c.number || !numbered || c.lines.some(l => HEADINGS.question.test(l.text)));

  const cases = kept.map(ch => parseCase(ch, source));
  const warnings = cases.flatMap(c => c.warnings.map(message => ({ caseId: c.id, title: c.title, message })));
  if (!cases.length) warnings.push({ caseId: null, title: '', message: 'No cases were found in this PDF.' });
  return { cases, warnings };
}

export function parseCase(chunk, source = { id: 'local', name: '' }) {
  const warnings = [];
  const c = {
    id: '', title: '', caseNumber: chunk.number || '', industry: '', type: '',
    difficulty: null, tags: {},
    prompt: '', clarifyingFacts: [], behavioral: '', frameworkHint: '',
    questions: [], exhibits: [], recap: '', recommendation: '',
    source: { id: source.id, name: source.name, firstPage: chunk.page },
    warnings
  };
  const lines = chunk.lines.slice();

  // Title: rest of the "Case N" line, the all-caps line just above it, or an all-caps line just below.
  if (chunk.rest && !HEADINGS.subtitle.test(chunk.rest)) c.title = chunk.rest;
  else if (chunk.pre) c.title = chunk.pre.text;
  else {
    const i = lines.slice(0, 4).findIndex(l => l.col === 'main' && isTitleLine(l.text));
    if (i >= 0) c.title = lines.splice(i, 1)[0].text;
  }
  // Subtitle "Industry | Type"
  const si = lines.slice(0, 8).findIndex(l => HEADINGS.subtitle.test(l.text) && !HEADINGS.question.test(l.text));
  if (si >= 0) {
    const m = HEADINGS.subtitle.exec(lines.splice(si, 1)[0].text);
    c.industry = m[1].trim();
    c.type = m[2].trim();
  } else if (chunk.rest && HEADINGS.subtitle.test(chunk.rest)) {
    const m = HEADINGS.subtitle.exec(chunk.rest);
    c.industry = m[1].trim(); c.type = m[2].trim();
  }

  const sec = { main: null, side: null };
  const clar = [];
  const exPages = new Map();     // n -> { page, stage }
  const unassigned = [];
  let q = null, skipPage = null;

  const caseAppend = (kind, text, bullet) => {
    if (kind === 'clarifying') return clar.push(text);
    c[kind] = joinText(c[kind], text, bullet);
  };
  const qAppend = (kind, text, bullet, raw) => {
    if (kind === 'answer') q.answer = joinText(q.answer, bullet ? `• ${text}` : text, bullet);
    else if (kind === 'transition') q.transition = joinText(q.transition, text);
    else if (kind === 'qtext') q.text = joinText(q.text, text);
    else if (kind === 'hint') {
      if (bullet || !q.hints.length || sec._newHint) { q.hints.push(text); sec._newHint = false; }
      else q.hints[q.hints.length - 1] = joinText(q.hints[q.hints.length - 1], text);
    } else if (kind === 'figures') {
      const row = toRow(text);
      if (row) q.framework.push(row);
      else if (q.framework.length) q.framework[q.framework.length - 1].value = joinText(q.framework[q.framework.length - 1].value, text);
      else q.notes = joinText(q.notes, raw);
    }
  };

  // Guidance can sit higher on the page than the question it belongs to. Question-level guidance in the
  // side column is held back and given to the next question when there's no current question yet, or when
  // the current one already has that section and another question starts further down the same page.
  let pending = null;
  const filled = kind => kind === 'answer' ? !!q.answer : kind === 'hint' ? q.hints.length > 0 : kind === 'transition' ? !!q.transition : q.framework.length > 0;
  const questionLater = i => lines.slice(i + 1).some(l => l.page === lines[i].page && l.col === 'main' && HEADINGS.question.test(l.text));

  const content = (ln, t) => {
    const bm = BULLET.exec(t);
    const text = bm ? bm[1] : t;
    const s = sec[ln.col];
    const figure = bm && toRow(text) && /\d/.test(toRow(text).value);
    if (q && s === 'hint' && figure) {
      // Order in the guidance is Answer, Hint, figures, Transition: bulleted figures after a hint are rows.
      q.framework.push(toRow(text));
      sec[ln.col] = 'figures';
    } else if (s === 'qtext' || (s && QUESTION_KINDS.includes(s))) {
      qAppend(s, s === 'qtext' ? t : text, !!bm, t);
    } else if (s) {
      caseAppend(s, s === 'clarifying' ? t : text, !!bm);
    } else if (q && ln.col === 'side' && figure) {
      q.framework.push(toRow(text));               // unlabelled bulleted figure in the guidance column
    } else if (q) {
      q.notes = joinText(q.notes, t);
    } else {
      unassigned.push(t);
    }
  };
  const heading = (ln, kind, rest) => {
    let target = kind;
    if (QUESTION_KINDS.includes(kind) && !q) target = kind === 'hint' ? 'frameworkHint' : null;
    if (kind === 'frameworkHint' && q) target = 'figures';
    sec[ln.col] = target;
    if (target === 'hint') sec._newHint = true;
    if (target && rest) (QUESTION_KINDS.includes(target) ? qAppend(target, rest, false, rest) : caseAppend(target, rest));
    if (!target) unassigned.push(ln.text);
  };

  lines.forEach((ln, i) => {
    if (ln.page === skipPage) return;
    const t = ln.text;
    let m;

    if ((m = HEADINGS.exhibit.exec(t)) && ln.y < ln.pageHeight * 0.3) {
      // An exhibit page: shown as an image, so its text is not parsed.
      const n = +m[1];
      if (!exPages.has(n)) exPages.set(n, { page: ln.page, stage: q ? q.n : 0, title: (m[2] || '').trim() });
      skipPage = ln.page;
      return;
    }
    if ((m = HEADINGS.question.exec(t))) {
      q = { n: +m[1], text: (m[2] || '').trim(), framework: [], answer: '', hints: [], transition: '', notes: '' };
      c.questions.push(q);
      sec.main = sec.side = null;
      sec[ln.col] = 'qtext';
      if (pending) {
        const ops = pending; pending = null;
        const keep = sec[ln.col];
        for (const op of ops) op.kind ? heading(op.ln, op.kind, op.rest) : content(op.ln, op.ln.text);
        sec.side = ln.col === 'side' ? keep : sec.side;
        if (ln.col === 'main') sec.main = keep;
      }
      return;
    }
    const kind = [...CASE_KINDS, ...QUESTION_KINDS].find(k => HEADINGS[k].test(t));
    const rest = kind ? (HEADINGS[kind].exec(t)[1] || '').trim() : '';

    if (ln.col === 'side' && kind && QUESTION_KINDS.includes(kind) && (!q || (filled(kind) && questionLater(i))) && lines.slice(i + 1).some(l => l.col === 'main' && HEADINGS.question.test(l.text))) {
      (pending ||= []).push({ ln, kind, rest });
      sec.side = '__pending';
      return;
    }
    if (pending && ln.col === 'side' && sec.side === '__pending' && !kind) { pending.push({ ln }); return; }
    if (kind) { heading(ln, kind, rest); return; }
    content(ln, t);
  });
  if (pending) for (const op of pending) unassigned.push(op.ln.text);

  c.clarifyingFacts = parseClarifying(clar, warnings);

  // Exhibits: shown at the first stage whose text mentions them; otherwise where the page sits.
  const refs = new Map();
  const scan = (text, stage) => { for (const m of text.matchAll(INLINE_EXHIBIT)) if (!refs.has(+m[1])) refs.set(+m[1], stage); };
  scan(c.prompt, 0);
  for (const qq of c.questions) scan(qq.text, qq.n);
  const nums = [...new Set([...exPages.keys(), ...refs.keys()])].sort((a, b) => a - b);
  c.exhibits = nums.map(n => {
    const page = exPages.get(n)?.page ?? null;
    const stage = refs.has(n) ? refs.get(n) : exPages.get(n).stage;
    if (page == null) warnings.push(`Exhibit ${n} is mentioned, but no page titled "Exhibit ${n}" was found.`);
    else if (!refs.has(n)) warnings.push(`Exhibit ${n} isn't mentioned in any question, so it will appear ${stage ? `with Question ${stage}` : 'at the start'}, where it sits in the PDF.`);
    return { n, page, stage, description: '' };
  });

  // Required pieces: warn, don't guess.
  if (!c.title) warnings.push('No title found.');
  if (!c.industry || !c.type) warnings.push('No "Industry | Type" subtitle found.');
  if (!c.prompt) warnings.push(unassigned.length
    ? 'No "Prompt" heading found. Unlabelled text after the title was not used.'
    : 'No prompt found.');
  if (!c.clarifyingFacts.length) warnings.push('No "Clarifying Information" found.');
  if (!c.questions.length) warnings.push('No "Question N:" blocks found.');
  for (const qq of c.questions) {
    if (!qq.text) warnings.push(`Question ${qq.n} has no question text.`);
    if (!qq.answer) warnings.push(`Question ${qq.n} has no Answer section.`);
  }
  if (!c.recommendation) warnings.push('No recommendation found.');

  c.id = `${slug(c.title || 'case')}-${fnv([c.title, c.caseNumber, c.industry, c.type, c.prompt.slice(0, 200)].join('|')).slice(0, 4)}`;
  return c;
}

/** Numbered "question? answer" pairs (or "Q: ... A: ..."). Pairs that can't be split become warnings. */
export function parseClarifying(lines, warnings = []) {
  const items = [];
  let cur = null;
  for (const l of lines) {
    const m = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(l);
    const qm = /^\s*Q\s*[:.]\s*(.*)$/.exec(l);
    if (m || qm) { cur = { raw: (m ? m[2] : qm[1]).trim() }; items.push(cur); }
    else if (cur) cur.raw = joinText(cur.raw, l.trim());
    else { cur = { raw: l.trim() }; items.push(cur); }
  }
  const facts = [];
  for (const it of items) {
    let q = '', a = '';
    const am = /^(.*?)\s+(?:A|Answer)\s*:\s*(.*)$/.exec(it.raw);
    if (am) { q = am[1].replace(/^Q\s*[:.]\s*/, ''); a = am[2]; }
    else {
      const i = it.raw.indexOf('?');
      if (i > 0) { q = it.raw.slice(0, i + 1); a = it.raw.slice(i + 1); }
    }
    q = q.trim(); a = a.trim();
    if (!q || !a) { warnings.push(`Couldn't split a clarifying item into question and answer: "${it.raw.slice(0, 50)}${it.raw.length > 50 ? '…' : ''}"`); continue; }
    facts.push({ q, a, keywords: keywords(q) });
  }
  return facts;
}

/* ---------- keywords ---------- */
const STOP = new Set(`a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its may me might my no not of on or our please shall should so some tell than that the their them then there these they this those to us was we were what whats when where which who whom whose why will with would you your yours about any much many know also just like give given get got is there are there anything something let lets need want see look be any more most other each per`.split(/\s+/));

export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}
export function tokens(text) {
  const words = String(text).toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').match(/[a-z][a-z0-9-]*/g) || [];
  return words.filter(w => !STOP.has(w)).map(stem).filter(w => w.length >= 3 && !STOP.has(w));
}
export function keywords(text) { return [...new Set(tokens(text))]; }

/** Entries whose keywords best match the text. Rare keywords count more than shared ones. */
export function matchByKeywords(entries, text, keysOf, { all = false } = {}) {
  const t = new Set(tokens(text));
  if (!t.size || !entries.length) return [];
  const df = new Map();
  for (const e of entries) for (const k of new Set(keysOf(e))) df.set(k, (df.get(k) || 0) + 1);
  const scored = entries.map((e, i) => {
    let s = 0, hits = 0;
    for (const k of new Set(keysOf(e))) if (t.has(k)) { s += 1 / df.get(k); hits++; }
    return { e, i, s, hits };
  }).filter(x => x.s >= 0.99);
  scored.sort((a, b) => b.s - a.s || b.hits - a.hits || a.i - b.i);
  return (all ? scored : scored.slice(0, 1)).map(x => x.e);
}

/* ---------- helpers ---------- */
function toRow(text) {
  const m = ROW.exec(text);
  if (!m) return null;
  return { label: m[1].trim(), value: m[2].trim(), givenOnRequest: false, keywords: keywords(m[1]) };
}
export function joinText(a, b, newline = false) {
  if (!b) return a || '';
  if (!a) return b;
  if (newline) return `${a}\n${b}`;
  if (a.endsWith('-') && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}
const slug = t => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'case';
