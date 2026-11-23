// Parser: pure functions, no DOM. Turns laid-out pages (from pdf-import.js) into case objects.
// Headings are matched with the patterns in HEADINGS. If your casebook uses other words, edit them there.
// Missing required pieces become warnings. The parser never invents content.
import { fnv } from './pdf-import.js';

const head = words => new RegExp(`^(?:${words})\\s*(?:[:\\-–—]\\s*(.*))?$`, 'i');

export const HEADINGS = {
  caseStart: /^case\s*(?:#|no\.?)?\s*(\d{1,3})\s*(?:[:.\-–—|]\s*(.*))?$/i,
  caseHeader: /^(\d\s?\d?\s?\d?)\s*\|\s*c\s?a\s?s\s?e\s*[:\-–—]\s*(.*)$/i,                 // running header "01 | CASE: TITLE"
  subtitle: /^([^|•]{2,60}?)\s*\|\s*([^|•]{2,60}?)\s*(?:[•●▪].*)?$/,
  question: /^question\s*(\d{1,2})\b\s*[:.)\-–—]?\s*(.*)$/i,
  exhibit: /^exhibit\s*(\d{1,2})\b\s*[:.)\-–—]?\s*(.*)$/i,
  stage: /^(brainstorm(?:ing)?|other options|additional (?:questions?|analysis)|synthesis|creative questions?|curveball)\s*:?$/i,
  conclusion: head('conclusion|wrap[- ]up|final question'),
  end: /^(interviewer feedback form|feedback form|interviewer evaluation|case feedback)\b/i,
  prompt: head('(?:case\\s+)?prompt|problem statement|case statement'),
  clarifying: head('clarifying (?:information|questions?|facts)'),
  behavioral: head('behaviou?ral(?: interview)?(?: questions?)?|fit questions?'),
  frameworkHint: head('(?:suggested |possible |sample )?(?:framework|structure)(?: guidance)?|how to move forward'),
  answer: head('(?:sample )?answers?|solution|(?:exhibit or )?question guidance|(?:question|exhibit)\\s*\\d{1,2}\\s+guidance|exhibit guidance|brainstorming guidance|guidance|best candidates?(?: (?:display|will|should))?|(?:sample )?calculations?'),
  hint: head('hints?'),
  figures: head('figures|data|numbers|given (?:on request|if asked)|information to (?:give|provide)|provide (?:this )?(?:only )?if (?:asked|requested)|if asked'),
  transition: head('transition'),
  recap: head('recap|case recap|teaching(?: notes| section)?|key takeaways'),
  recommendation: head('(?:sample |final )?recommendations?'),
  recExtra: head('risks?|next steps?')
};

const CASE_KINDS = ['prompt', 'clarifying', 'behavioral', 'frameworkHint', 'recap', 'recommendation'];
const QUESTION_KINDS = ['answer', 'hint', 'figures', 'transition'];
const ALL_KINDS = [...QUESTION_KINDS, ...CASE_KINDS];      // guidance first: "Brainstorming Guidance" is guidance, not a stage
const BULLET = /^\s*(?:[•●▪◦‣\-–*]|\d{1,2}[.)])\s+(.*)$/;
const ROW = /^(.{1,60}?)\s*(?::|=|\s[–—-]\s)\s*(.+)$/;
const INLINE_EXHIBIT = /\bexhibit\s*(\d{1,2})\b/gi;

export function isTitleLine(t) {
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && t.length <= 80 && t === t.toUpperCase() && /[A-Z]/.test(t) && !isHeading(t);
}
function isHeading(t) {
  return HEADINGS.question.test(t) || HEADINGS.exhibit.test(t) || HEADINGS.conclusion.test(t) || HEADINGS.end.test(t) || HEADINGS.recExtra.test(t) || ALL_KINDS.some(k => HEADINGS[k].test(t));
}
const titleCase = t => t.toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase());

/**
 * parseCasebook(pages, { source }) -> { cases, warnings }
 * pages: output of buildPages(). source: { id, name } of the imported file.
 */
export function parseCasebook(pages, { source = { id: 'local', name: 'casebook.pdf' } } = {}) {
  const lines = [];
  for (const p of pages) {
    let first = true;
    for (const l of p.lines) {
      const text = l.text.trim();
      if (!text) continue;
      lines.push({ text, col: l.col === 'side' ? 'side' : 'main', page: p.page, y: l.y, size: l.size || 10, pageHeight: p.height, pageFirst: first && l.col !== 'side' });
      if (l.col !== 'side') first = false;
    }
  }

  // A case starts at "Case N", at a running header "N | CASE: TITLE", or at an ALL CAPS title followed by "Industry | Type".
  const chunks = [];
  let cur = null;
  lines.forEach((ln, i) => {
    let start = null;
    if (ln.col === 'main' && ln.text.length <= 90) {
      const h = HEADINGS.caseHeader.exec(ln.text) || HEADINGS.caseStart.exec(ln.text);
      if (h) {
        const number = String(+h[1].replace(/\s/g, ''));
        if (cur && cur.number === number) return;                    // the same case's header on a later page
        const letters = t => String(t).toLowerCase().replace(/[^a-z]/g, '');
        if (cur && !cur.number && cur.titled && h[2] && (letters(cur.lines[0].text).includes(letters(h[2])) || letters(h[2]).includes(letters(cur.lines[0].text)))) {
          cur.number = number;                                        // the case opened on a page without the header
          return;
        }
        start = { number, rest: (h[2] || '').trim() };
      } else if (isTitleLine(ln.text)) {
        const next = lines.slice(i + 1, i + 3).find(l => l.col === 'main' && l.page === ln.page);
        const fresh = cur && cur.page === ln.page && cur.lines.length < 4;
        if (next && HEADINGS.subtitle.test(next.text) && !fresh) start = { number: null, rest: '', titled: true };
      }
    }
    if (start) {
      const prev = cur?.lines[cur.lines.length - 1];
      const pre = !start.titled && prev && prev.page === ln.page && isTitleLine(prev.text) ? cur.lines.pop() : null;
      cur = { ...start, pre, lines: start.titled ? [ln] : [], page: ln.page };
      chunks.push(cur);
      return;
    }
    if (!cur) { cur = { number: null, rest: '', pre: null, lines: [], page: ln.page }; chunks.push(cur); }
    cur.lines.push(ln);
  });
  // Front matter (introductions, industry overviews) holds no questions or prompt, so it is dropped.
  const isCase = c => c.number || c.titled || c.lines.some(l => HEADINGS.question.test(l.text) || HEADINGS.prompt.test(l.text));
  const kept = chunks.filter(isCase);

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
    questions: [], exhibits: [], conclusion: '', recap: '', recommendation: '',
    source: { id: source.id, name: source.name, firstPage: chunk.page },
    warnings
  };
  const lines = chunk.lines.slice();

  // Title: an ALL CAPS line followed by the subtitle, the rest of the case line, or an ALL CAPS line nearby.
  const ti = lines.slice(0, 6).findIndex((l, i) => l.col === 'main' && isTitleLine(l.text) && HEADINGS.subtitle.test(lines[i + 1]?.text || ''));
  if (ti >= 0) c.title = lines.splice(ti, 1)[0].text;
  else if (chunk.rest && !HEADINGS.subtitle.test(chunk.rest)) c.title = chunk.rest;
  else if (chunk.pre) c.title = chunk.pre.text;
  else {
    const i = lines.slice(0, 4).findIndex(l => l.col === 'main' && isTitleLine(l.text));
    if (i >= 0) c.title = lines.splice(i, 1)[0].text;
  }
  if (!c.title && chunk.rest) c.title = chunk.rest;
  const si = lines.slice(0, 8).findIndex(l => HEADINGS.subtitle.test(l.text) && !HEADINGS.question.test(l.text));
  const sub = si >= 0 ? lines.splice(si, 1)[0].text : (HEADINGS.subtitle.test(chunk.rest) ? chunk.rest : '');
  if (sub) { const m = HEADINGS.subtitle.exec(sub); c.industry = m[1].trim(); c.type = m[2].trim(); }

  const sec = { main: null, side: null };
  const clar = [];
  const exPages = new Map();     // n -> { page, before: questions seen so far }
  const unassigned = [];
  let q = null, skipPage = null, ended = false;

  const newQuestion = (num, label, text = '') => {
    q = { n: num ?? 0, num, label, text, framework: [], answer: '', hints: [], transition: '', notes: '' };
    c.questions.push(q);
    return q;
  };
  const addRow = (row, sentence) => {
    if (!row) return;
    const key = `${row.label}|${row.value}`;
    if (!q.framework.some(r => `${r.label}|${r.value}` === key)) q.framework.push(row);
    if (sentence) row.sentence = true;
  };
  const caseAppend = (kind, text, bullet) => {
    if (kind === 'clarifying') return clar.push(text);
    if (kind === 'behavioral' && /^(interview|questions?:?)$/i.test(text)) return;       // split "Behavioral / Interview / Question:" heading
    c[kind] = joinText(c[kind], kind === 'recommendation' && bullet ? `• ${text}` : text, bullet);
  };
  const qAppend = (kind, text, bullet, raw) => {
    if (kind === 'answer') {
      q.answer = joinText(q.answer, bullet ? `• ${text}` : text, bullet);
      // Bulleted figures inside the guidance are offered as rows, so you can mark the ones given on request.
      if (bullet && /\d/.test(text) && !/[=*×÷]/.test(text)) addRow(toRow(text) || { label: text, value: '', givenOnRequest: false, keywords: keywords(text) }, true);
    }
    else if (kind === 'transition') q.transition = joinText(q.transition, text);
    else if (kind === 'qtext') q.text = joinText(q.text, bullet ? text : raw);
    else if (kind === 'hint') {
      if (bullet || !q.hints.length || sec._newHint) { q.hints.push(text); sec._newHint = false; }
      else q.hints[q.hints.length - 1] = joinText(q.hints[q.hints.length - 1], text);
    } else if (kind === 'figures') {
      const row = toRow(text);
      if (row) addRow(row);
      else if (q.framework.length) q.framework[q.framework.length - 1].value = joinText(q.framework[q.framework.length - 1].value, text);
      else q.notes = joinText(q.notes, raw);
    }
  };

  // Guidance can sit higher on the page than the question it belongs to (see test 7).
  let pending = null;
  const filled = kind => kind === 'answer' ? !!q.answer : kind === 'hint' ? q.hints.length > 0 : kind === 'transition' ? !!q.transition : q.framework.length > 0;
  const questionLater = i => lines.slice(i + 1).some(l => l.page === lines[i].page && l.col === 'main' && HEADINGS.question.test(l.text));

  const content = (ln, t) => {
    if (/^[•●▪◦‣\-–*]$/.test(t)) return;                           // a bullet glyph on its own line
    const bm = BULLET.exec(t);
    const text = bm ? bm[1] : t;
    let s = sec[ln.col];
    const figure = bm && toRow(text) && /\d/.test(toRow(text).value);
    // Question text is one block. It ends at a paragraph gap, after a "?", at a "Label:" line or at a bulleted figure;
    // whatever follows is the interviewer's material.
    if (s === 'qtext' && q.text && (ln.gap > ln.size * 2.2 || /\?["”’)]?$/.test(q.text) || /:\s*$/.test(t) || (bm && /\d/.test(text)))) { s = sec[ln.col] = 'answer'; }
    if (q && s === 'hint' && figure) {
      q.framework.push(toRow(text));
      sec[ln.col] = 'figures';
    } else if (s === 'qtext' || (s && QUESTION_KINDS.includes(s))) {
      qAppend(s, text, !!bm, t);
    } else if (s === 'conclusion') {
      c.conclusion = joinText(c.conclusion, t);
    } else if (s) {
      caseAppend(s, s === 'clarifying' ? t : text, !!bm);
    } else if (q && ln.col === 'side' && figure) {
      addRow(toRow(text));
    } else if (q) {
      q.notes = joinText(q.notes, t);
    } else {
      unassigned.push(t);
    }
  };
  const heading = (ln, kind, rest) => {
    let target = kind;
    if (QUESTION_KINDS.includes(kind) && !q) target = kind === 'hint' ? 'frameworkHint' : kind === 'answer' ? 'frameworkHint' : null;
    if (kind === 'frameworkHint' && q) target = 'answer';            // framework guidance under a question is that question's guidance
    sec[ln.col] = target;
    if (target === 'hint') sec._newHint = true;
    if (target && rest) (QUESTION_KINDS.includes(target) ? qAppend(target, rest, false, rest) : caseAppend(target, rest));
    if (!target) unassigned.push(ln.text);
  };

  const lastY = {};
  lines.forEach((ln, i) => {
    if (ended || ln.page === skipPage) return;
    const prev = lastY[ln.col];
    ln.gap = prev && prev.page === ln.page ? ln.y - prev.y : Infinity;
    lastY[ln.col] = ln;
    const t = ln.text;
    let m;

    if (HEADINGS.end.test(t)) { ended = true; return; }                  // e.g. a feedback form after the case
    if ((m = HEADINGS.exhibit.exec(t)) && ln.y < ln.pageHeight * 0.3 && !/^guidance\b/i.test(m[2] || '')) {
      // An exhibit page: shown as an image, so its text is not parsed.
      const n = +m[1];
      if (!exPages.has(n)) exPages.set(n, { page: ln.page, before: c.questions.length });
      skipPage = ln.page;
      return;
    }
    if ((m = HEADINGS.question.exec(t)) && !HEADINGS.answer.test(t)) {
      const num = +m[1];
      const rest = (m[2] || '').trim();
      if (q && q.num === num) {
        // A second page for the same question: what follows is guidance.
        sec[ln.col] = 'answer';
        if (rest && !rest.startsWith('(')) qAppend('answer', rest, false, rest);
        return;
      }
      newQuestion(num, `Question ${num}`, rest.startsWith('(') ? '' : rest);
      sec.main = sec.side = null;
      sec[ln.col] = 'qtext';
      if (ln.col === 'side') sec.main = 'qtext';                     // heading in the narrow column, text beside it
      if (pending) {
        const ops = pending; pending = null;
        const keep = sec[ln.col];
        for (const op of ops) op.kind ? heading(op.ln, op.kind, op.rest) : content(op.ln, op.ln.text);
        sec[ln.col] = keep;
      }
      return;
    }
    if ((m = HEADINGS.conclusion.exec(t))) {
      q = null;
      sec.main = sec.side = null;
      sec[ln.col] = 'conclusion';
      if (m[1]) c.conclusion = joinText(c.conclusion, m[1].trim());
      return;
    }
    if ((m = HEADINGS.recExtra.exec(t))) {
      sec[ln.col] = 'recommendation';
      c.recommendation = joinText(c.recommendation, `${titleCase(t.replace(/[:\-–—].*$/, '').trim())}:${m[1] ? ` ${m[1].trim()}` : ''}`, true);
      return;
    }
    const kind = ALL_KINDS.find(k => HEADINGS[k].test(t));
    // Other interview stages (brainstorming and the like): a named stage, or an ALL CAPS line opening a page.
    if (!kind && ln.col === 'main' && (HEADINGS.stage.test(t) || (ln.pageFirst && c.title && isTitleLine(t) && !c.title.toUpperCase().includes(t) && t.split(/\s+/).length <= 5))) {
      newQuestion(null, titleCase(t.replace(/:$/, '')));
      sec.main = sec.side = null;
      sec.main = 'qtext';
      return;
    }
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
  if (!c.recommendation && c.conclusion) { c.recommendation = c.conclusion; c.conclusion = ''; }

  // Text under a question heading that is really a note to the interviewer moves to the guidance.
  for (const qq of c.questions) {
    if (/^(?:the )?(?:candidate|interviewee|interviewer)s?\b|^if (?:the )?(?:candidate|interviewee)\b/i.test(qq.text)) {
      qq.answer = joinText(qq.text, qq.answer, true);
      qq.text = '';
    }
  }
  // A stage heading with nothing under it (a section divider, say) is dropped.
  c.questions = c.questions.filter(qq => qq.text || qq.answer || qq.hints.length || qq.framework.length || qq.transition);
  // Number stages in order. Labels keep the casebook's names ("Question 2", "Brainstorming").
  c.questions.forEach((qq, i) => { qq.n = i + 1; delete qq.num; });

  // Exhibits: shown at the first stage whose text mentions them; otherwise with the stage that follows the page.
  const refs = new Map();
  const scan = (text, stage) => { for (const mm of text.matchAll(INLINE_EXHIBIT)) if (!refs.has(+mm[1])) refs.set(+mm[1], stage); };
  scan(c.prompt, 0);
  for (const qq of c.questions) scan(qq.text, qq.n);
  const nums = [...new Set([...exPages.keys(), ...refs.keys()])].sort((a, b) => a - b);
  c.exhibits = nums.map(n => {
    const ex = exPages.get(n);
    const positional = ex ? (c.questions[ex.before] || c.questions[ex.before - 1])?.n ?? 0 : 0;
    const stage = refs.has(n) ? refs.get(n) : positional;
    if (!ex) warnings.push(`Exhibit ${n} is mentioned, but no page titled "Exhibit ${n}" was found.`);
    return { n, page: ex?.page ?? null, stage, description: '' };
  });

  // Required pieces: warn, don't guess.
  if (!c.title) warnings.push('No title found.');
  if (!c.industry || !c.type) warnings.push('No "Industry | Type" subtitle found.');
  if (!c.prompt) warnings.push(unassigned.length
    ? 'No "Prompt" heading found. Unlabelled text after the title was not used.'
    : 'No prompt found.');
  if (!c.clarifyingFacts.length) warnings.push('No "Clarifying Information" found.');
  if (!c.questions.length) warnings.push('No questions found.');
  for (const qq of c.questions) {
    if (!qq.text) warnings.push(`${qq.label} has no question text.`);
    if (!qq.answer) warnings.push(`${qq.label} has no answer or guidance section.`);
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
    const tm = /^\s*(?:[•●▪\-–]\s*)?[A-Z][^:?]{1,38}:\s+\S/.test(l) && !/^\s*(?:A|Answer)\s*:/.test(l);   // "Topic: fact"
    if (m || qm) { cur = { raw: (m ? m[2] : qm[1]).trim() }; items.push(cur); }
    else if (tm) { cur = { raw: l.replace(/^\s*[•●▪\-–]\s*/, '').trim() }; items.push(cur); }
    else if (cur) cur.raw = joinText(cur.raw, l.trim());
    else { cur = { raw: l.trim() }; items.push(cur); }
  }
  const facts = [];
  for (const it of items) {
    if (/^note\s*:/i.test(it.raw)) continue;                    // a note to the interviewer, not a fact
    let q = '', a = '', topic = false;
    const am = /^(.*?)\s+(?:A|Answer)\s*:\s*(.*)$/.exec(it.raw);
    if (am) { q = am[1].replace(/^Q\s*[:.]\s*/, ''); a = am[2]; }
    else {
      const i = it.raw.indexOf('?');
      const tm = /^([^:?]{2,40}):\s*(.+)$/.exec(it.raw);
      if (i > 0) { q = it.raw.slice(0, i + 1); a = it.raw.slice(i + 1); }
      else if (tm) { q = tm[1]; a = tm[2]; topic = true; }          // "Topic: fact" style
    }
    q = q.trim(); a = a.trim();
    if (!q || !a) { warnings.push(`Couldn't split a clarifying item into question and answer: "${it.raw.slice(0, 50)}${it.raw.length > 50 ? '…' : ''}"`); continue; }
    facts.push({ q, a, keywords: keywords(topic ? `${q} ${a}` : q) });
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
