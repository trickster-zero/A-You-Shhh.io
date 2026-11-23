// Interview flow as a pure state machine. No DOM, no storage, no timers.
// The UI renders only view(caseObj, state). Anything the stage doesn't allow never enters the view,
// so answers, hints and numbers cannot reach the page early.
import { matchByKeywords } from './parser.js';

export const NOT_IN_MATERIALS = "That isn't in the case materials.";
export const RUBRIC = ['structure', 'math', 'synthesis', 'communication'];
export const HINT_NOTE = 'Each hint costs 1 point in practice mode.';
export const MODES = ['practice', 'study'];
const ENDED = new Set(['done', 'skipped']);
const REVEALED = new Set(['reveal', 'done', 'skipped']);

/* ======================= Tags ======================= */

const rowKey = (qn, i) => `${qn}:${i}`;

/** What the user still needs to tag before this case can run. Never throws. */
export function tagRequest(c, tags = {}) {
  const fields = [];
  const t = tags || {};
  if (!isLevel(t.difficulty ?? c.difficulty)) fields.push('difficulty');
  if (!isLevel(t.math ?? c.tags?.math)) fields.push('math');
  if (!isLevel(t.creativity ?? c.tags?.creativity)) fields.push('creativity');
  const hasRows = (c.questions || []).some(q => q.framework?.length);
  if (hasRows && t.rowsTagged !== true) fields.push('givenOnRequest');
  const optional = [];
  if (!c.recap && !t.recap) optional.push('recap');
  if ((c.exhibits || []).some(e => !e.description && !t.exhibits?.[e.n])) optional.push('exhibitDescriptions');
  return { needed: fields.length > 0, fields, optional };
}
const isLevel = v => v === 1 || v === 2 || v === 3;

/** Returns a copy of the case with the user's tags applied. */
export function applyTags(c, tags = {}) {
  const t = tags || {};
  return {
    ...c,
    difficulty: t.difficulty ?? c.difficulty ?? null,
    tags: { ...c.tags, ...(isLevel(t.math) ? { math: t.math } : {}), ...(isLevel(t.creativity) ? { creativity: t.creativity } : {}) },
    recap: c.recap || t.recap || '',
    exhibits: (c.exhibits || []).map(e => ({ ...e, description: e.description || t.exhibits?.[e.n] || '' })),
    questions: (c.questions || []).map(q => ({
      ...q,
      framework: (q.framework || []).map((r, i) => ({ ...r, givenOnRequest: t.rows ? !!t.rows[rowKey(q.n, i)] : !!r.givenOnRequest }))
    }))
  };
}
export { rowKey };

/* ======================= Session ======================= */

/**
 * start(caseObj, { mode, at }) -> { state, out }
 * out is a list of { speak } lines for the speech layer. The case should already have tags applied.
 */
export function start(c, { mode = 'practice', at = null } = {}) {
  const s = {
    caseId: c.id, mode: MODES.includes(mode) ? mode : 'practice',
    stage: 'intro', qi: -1, phase: null,
    log: [], hints: { framework: 0, q: {} }, rows: {}, exhibitsShown: [],
    answers: { framework: '', q: {}, behavioral: '', recommendation: '' },
    rubric: {}, startedAt: at, finishedAt: null
  };
  const out = [];
  say(s, out, c.prompt || 'This case has no prompt. Check the import warnings for this case.', 'prompt');
  showExhibits(c, s, out, 0);
  return { state: s, out };
}

/** Applies one action. Returns a new state and the lines to read aloud. Invalid actions return the state unchanged. */
export function dispatch(c, prev, action) {
  const s = clone(prev);
  const out = [];
  const a = action || {};
  if (ENDED.has(s.stage) && a.type !== 'noop') return { state: prev, out };

  switch (a.type) {
    case 'ask': {
      const text = String(a.text || '').trim();
      if (!text || !['intro', 'framework', 'question'].includes(s.stage)) break;
      you(s, text, 'ask');
      if (s.stage === 'question') {
        const q = c.questions[s.qi];
        const rows = (q.framework || []).map((r, i) => ({ ...r, i })).filter(r => r.givenOnRequest);
        const hits = matchByKeywords(rows, text, r => r.keywords || [], { all: true });
        if (hits.length) {
          const shown = new Set(s.rows[q.n] || []);
          for (const r of hits) shown.add(r.i);
          s.rows[q.n] = [...shown].sort((x, y) => x - y);
          say(s, out, hits.map(r => `${r.label}: ${r.value}`).join('. '), 'data');
          break;
        }
      }
      const fact = matchByKeywords(c.clarifyingFacts || [], text, f => f.keywords || [])[0];
      say(s, out, fact ? fact.a : NOT_IN_MATERIALS, fact ? 'fact' : 'none');
      break;
    }
    case 'toFramework':
      if (s.stage !== 'intro') break;
      s.stage = 'framework';
      say(s, out, 'Take a moment to structure your approach, then share your framework.', 'cue');
      break;
    case 'hint': {
      if (s.stage === 'framework') {
        if (s.hints.framework > 0 || !c.frameworkHint) { say(s, out, c.frameworkHint ? 'That was the only framework hint.' : 'There is no framework hint in the case materials.', 'cue'); break; }
        s.hints.framework = 1;
        say(s, out, c.frameworkHint, 'hint');
      } else if (s.stage === 'question' && s.phase === 'ask') {
        const q = c.questions[s.qi];
        const used = s.hints.q[q.n] || 0;
        if (used >= (q.hints || []).length) { say(s, out, q.hints?.length ? 'No more hints for this question.' : 'There are no hints for this question.', 'cue'); break; }
        s.hints.q[q.n] = used + 1;
        say(s, out, q.hints[used], 'hint');
      }
      break;
    }
    case 'submitFramework': {
      const text = String(a.text || '').trim();
      if (s.stage !== 'framework' || !text) break;
      s.answers.framework = text;
      you(s, text, 'framework');
      advanceToQuestion(c, s, out, 0);
      break;
    }
    case 'submitAnswer': {
      const text = String(a.text || '').trim();
      if (s.stage !== 'question' || s.phase !== 'ask' || !text) break;
      const q = c.questions[s.qi];
      s.answers.q[q.n] = text;
      you(s, text, 'answer');
      s.phase = 'answered';
      if (q.transition) say(s, out, q.transition, 'transition');
      break;
    }
    case 'next':
      if (s.stage !== 'question' || s.phase !== 'answered') break;
      advanceToQuestion(c, s, out, s.qi + 1);
      break;
    case 'submitBehavioral':
    case 'skipBehavioral': {
      if (s.stage !== 'behavioral') break;
      const text = String(a.text || '').trim();
      if (a.type === 'submitBehavioral') { if (!text) break; s.answers.behavioral = text; you(s, text, 'behavioral'); }
      toRecommendation(s, out);
      break;
    }
    case 'submitRecommendation': {
      const text = String(a.text || '').trim();
      if (s.stage !== 'recommendation' || !text) break;
      s.answers.recommendation = text;
      you(s, text, 'recommendation');
      say(s, out, c.recommendation ? `Here is the recommendation from the case: ${c.recommendation}` : 'There is no recommendation in the case materials.', 'recommendation');
      s.stage = 'debrief';
      break;
    }
    case 'rate': {
      if (!['debrief', 'reveal'].includes(s.stage) || !RUBRIC.includes(a.key)) break;
      const n = +a.n;
      if (!c.questions.some(q => q.n === n)) break;
      s.rubric[n] = { ...(s.rubric[n] || {}), [a.key]: !!a.value };
      break;
    }
    case 'reveal':
      if (s.stage === 'debrief') s.stage = 'reveal';
      break;
    case 'finish':
      if (s.stage !== 'reveal') break;
      s.stage = 'done';
      s.finishedAt = a.at ?? null;
      break;
    case 'skip':
      s.stage = 'skipped';
      s.finishedAt = a.at ?? null;
      break;
    default:
      return { state: prev, out };
  }
  return { state: s, out };
}

function advanceToQuestion(c, s, out, i) {
  if (i < c.questions.length) {
    const q = c.questions[i];
    s.stage = 'question'; s.qi = i; s.phase = 'ask';
    say(s, out, `Question ${q.n}. ${q.text || '(No question text was found in the PDF.)'}`, 'question');
    showExhibits(c, s, out, q.n);
  } else if (c.behavioral) {
    s.stage = 'behavioral'; s.qi = -1; s.phase = null;
    say(s, out, c.behavioral, 'behavioral');
  } else {
    toRecommendation(s, out);
  }
}
function toRecommendation(s, out) {
  s.stage = 'recommendation'; s.qi = -1; s.phase = null;
  say(s, out, 'Please give your recommendation.', 'cue');
}
function showExhibits(c, s, out, stage) {
  for (const e of c.exhibits || []) {
    if (e.stage !== stage || s.exhibitsShown.includes(e.n)) continue;
    s.exhibitsShown.push(e.n);
    s.log.push({ who: 'interviewer', kind: 'exhibit', n: e.n, page: e.page, text: e.description || '' });
    out.push({ speak: e.description ? `Exhibit ${e.n}. ${e.description}` : `Here is Exhibit ${e.n}.` });
  }
}
function say(s, out, text, kind) { s.log.push({ who: 'interviewer', kind, text }); out.push({ speak: text }); }
function you(s, text, kind) { s.log.push({ who: 'you', kind, text }); }
const clone = o => JSON.parse(JSON.stringify(o));

/* ======================= Scoring ======================= */

/** Rubric checks per question minus hints used (practice mode). Framework hints come off the total. */
export function score(c, s) {
  const practice = s.mode === 'practice';
  const questions = c.questions.map(q => {
    const r = s.rubric[q.n] || {};
    return { n: q.n, structure: !!r.structure, math: !!r.math, synthesis: !!r.synthesis, communication: !!r.communication, hints: s.hints.q[q.n] || 0 };
  });
  const max = questions.length * RUBRIC.length;
  let points = questions.reduce((sum, q) => sum + Math.max(0, RUBRIC.filter(k => q[k]).length - (practice ? q.hints : 0)), 0);
  if (practice) points = Math.max(0, points - s.hints.framework);
  return { points, max, pct: max ? Math.round((points / max) * 100) : 0, frameworkHints: s.hints.framework, questions };
}

/* ======================= View ======================= */

/** The only data the UI may render. Built from what the current stage allows. */
export function view(c, s) {
  const q = s.stage === 'question' ? c.questions[s.qi] : null;
  const v = {
    case: { id: c.id, title: c.title, caseNumber: c.caseNumber, industry: c.industry, type: c.type, difficulty: c.difficulty ?? null },
    stage: s.stage, mode: s.mode, phase: s.phase,
    progress: { index: s.qi, total: c.questions.length, numbers: c.questions.map(x => x.n) },
    hasBehavioral: !!c.behavioral,
    log: s.log.map(e => ({ ...e })),
    current: q ? {
      n: q.n,
      hintsLeft: Math.max(0, (q.hints || []).length - (s.hints.q[q.n] || 0)),
      hintsUsed: s.hints.q[q.n] || 0,
      canAskData: (q.framework || []).some(r => r.givenOnRequest)
    } : null,
    framework: s.stage === 'framework' ? { hintAvailable: !!c.frameworkHint && s.hints.framework === 0, hintsUsed: s.hints.framework } : null,
    hintNote: s.mode === 'practice' ? HINT_NOTE : 'Hints are free in study mode.',
    exhibits: s.exhibitsShown.map(n => { const e = c.exhibits.find(x => x.n === n); return { n, page: e?.page ?? null, description: e?.description || '' }; }),
    debrief: null, reveal: null, score: null
  };
  if (['debrief', 'reveal', 'done'].includes(s.stage)) {
    v.debrief = {
      framework: s.answers.framework,
      frameworkHints: s.hints.framework,
      questions: c.questions.map(x => ({
        n: x.n, text: x.text, yourAnswer: s.answers.q[x.n] || '',
        hintsUsed: s.hints.q[x.n] || 0,
        rubric: Object.fromEntries(RUBRIC.map(k => [k, !!s.rubric[x.n]?.[k]]))
      })),
      behavioral: s.answers.behavioral, recommendation: s.answers.recommendation
    };
  }
  if (REVEALED.has(s.stage)) {
    v.reveal = {
      prompt: c.prompt,
      clarifyingFacts: (c.clarifyingFacts || []).map(f => ({ q: f.q, a: f.a })),
      frameworkHint: c.frameworkHint || '',
      questions: c.questions.map(x => ({
        n: x.n, text: x.text, answer: x.answer, hints: [...(x.hints || [])], transition: x.transition || '', notes: x.notes || '',
        framework: (x.framework || []).map(r => ({ label: r.label, value: r.value, givenOnRequest: !!r.givenOnRequest }))
      })),
      behavioral: c.behavioral || '', recommendation: c.recommendation || '', recap: c.recap || '',
      exhibits: (c.exhibits || []).map(e => ({ n: e.n, page: e.page, description: e.description || '' }))
    };
  }
  if (s.stage === 'done') v.score = score(c, s);
  return v;
}
