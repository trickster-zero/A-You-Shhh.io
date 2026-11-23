// UI wiring only. Rules live in engine.js, parsing in parser.js, storage in store.js.
// During a session the page is built only from engine.view(), so it can't show anything early.
import { readPdf, buildPages, sourceIdFor, rememberPdf, recallPdf, openPdf, renderPageImage, forgetPdfs } from './pdf-import.js';
import { parseCasebook } from './parser.js';
import * as engine from './engine.js';
import { createStore } from './store.js';
import { createSpeech } from './speech.js';

/* ======================= DOM helpers ======================= */
export function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of [].concat(kids)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const btn = (label, onclick, attrs = {}) => h('button', { type: 'button', class: 'btn', onclick, ...attrs }, label);

function textForm({ id, label, multiline = false, submit, onSubmit, note, primary = false }) {
  const field = multiline
    ? h('textarea', { id, rows: 5, 'aria-describedby': note ? `${id}-note` : null })
    : h('input', { id, type: 'text', autocomplete: 'off', 'aria-describedby': note ? `${id}-note` : null });
  if (primary) field.dataset.primary = '1';
  const form = h('form', {
    class: 'text-form',
    onsubmit: e => {
      e.preventDefault();
      const t = field.value.trim();
      if (!t) { field.focus(); return; }
      onSubmit(t);
    }
  }, [
    h('label', { for: id }, label),
    note ? h('p', { class: 'field-note', id: `${id}-note` }, note) : null,
    h('div', { class: multiline ? 'field-stack' : 'field-row' }, [field, h('button', { type: 'submit', class: 'btn btn-primary' }, submit)])
  ]);
  if (multiline) field.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });
  return form;
}

/* ======================= Session view (pure render of engine.view) ======================= */
const STAGE_LABEL = { intro: 'Intro', framework: 'Framework', behavioral: 'Behavioral', recommendation: 'Recommendation', debrief: 'Debrief', reveal: 'Debrief', done: 'Debrief', skipped: 'Skipped' };
const KIND_LABEL = { hint: 'Hint', data: 'Data', fact: 'Clarification', transition: 'Transition', recommendation: 'Recommendation', behavioral: 'Behavioral', question: 'Question', prompt: 'Prompt' };

/** Builds the session screen from a view object. Handlers are optional, so tests can render without wiring. */
export function renderView(v, on = {}) {
  const ended = v.stage === 'done' || v.stage === 'skipped';
  const meta = [[v.case.industry, v.case.type].filter(Boolean).join(' | '), v.case.caseNumber && `Case ${v.case.caseNumber}`, v.case.difficulty && `Difficulty ${v.case.difficulty}`, v.mode === 'practice' ? 'Practice mode' : 'Study mode'].filter(Boolean);

  const root = h('section', { class: 'session', 'aria-labelledby': 'session-title' }, [
    h('header', { class: 'session-head' }, [
      h('p', { class: 'eyebrow' }, meta.join(' · ')),
      h('h1', { class: 'display', id: 'session-title' }, v.case.title || 'Untitled case'),
      trail(v),
      h('div', { class: 'head-actions' }, [
        ended ? null : btn('Skip case', () => on.skip?.(), { class: 'btn btn-quiet', title: 'Reveals everything and records no score' }),
        btn(ended ? 'Back to cases' : 'Leave case', () => on.exit?.(), { class: 'btn btn-quiet' })
      ])
    ])
  ]);

  const transcript = h('ol', { class: 'transcript', 'aria-live': 'polite', 'aria-label': 'Interview transcript' }, v.log.map(entry => {
    if (entry.kind === 'exhibit') {
      return h('li', { class: 'msg msg-exhibit' }, h('figure', { class: 'exhibit', 'data-n': entry.n, 'data-page': entry.page ?? '' }, [
        h('div', { class: 'exhibit-img' }, entry.page ? `Loading page ${entry.page}…` : 'No page was found for this exhibit.'),
        h('figcaption', {}, [h('strong', {}, `Exhibit ${entry.n}`), entry.page ? ` · PDF page ${entry.page}` : '', entry.text ? `. ${entry.text}` : ''])
      ]));
    }
    const mine = entry.who === 'you';
    return h('li', { class: `msg ${mine ? 'msg-you' : 'msg-interviewer'} kind-${entry.kind}` }, [
      h('p', { class: 'who' }, mine ? 'You' : `Interviewer${KIND_LABEL[entry.kind] ? ` · ${KIND_LABEL[entry.kind]}` : ''}`),
      h('p', { class: 'msg-text' }, entry.text)
    ]);
  }));

  root.append(h('div', { class: 'session-body' }, [
    h('div', { class: 'transcript-wrap' }, transcript),
    h('div', { class: 'controls' }, controls(v, on))
  ]));

  if (v.debrief && !ended) root.append(rubric(v, on));
  if (v.stage === 'done' && v.score) root.append(scorePanel(v));
  if (v.reveal) root.append(revealPanel(v));
  if (v.stage === 'done') root.append(rubric(v, on, true));
  return root;
}

function trail(v) {
  const steps = ['intro', 'framework', ...v.progress.numbers.map(n => `q${n}`), ...(v.hasBehavioral ? ['behavioral'] : []), 'recommendation', 'debrief'];
  const cur = v.stage === 'question' ? `q${v.progress.numbers[v.progress.index]}` : ['reveal', 'done'].includes(v.stage) ? 'debrief' : v.stage;
  const at = steps.indexOf(cur);
  return h('ol', { class: 'trail', 'aria-label': 'Interview stages' }, steps.map((s, i) => h('li', {
    class: i < at ? 'is-past' : i === at ? 'is-current' : '',
    'aria-current': i === at ? 'step' : null
  }, s.startsWith('q') ? `Q${s.slice(1)}` : STAGE_LABEL[s])));
}

function controls(v, on) {
  switch (v.stage) {
    case 'intro':
      return [
        textForm({ id: 'ask', label: 'Ask a clarifying question', submit: 'Ask', onSubmit: t => on.ask?.(t), primary: true }),
        h('div', { class: 'row' }, btn('Ready to structure', () => on.toFramework?.(), { class: 'btn btn-primary' }))
      ];
    case 'framework':
      return [
        textForm({ id: 'framework', label: 'Your framework', multiline: true, submit: 'Share framework', onSubmit: t => on.submitFramework?.(t), primary: true, note: 'Ctrl+Enter or ⌘+Enter also submits.' }),
        hintBlock(v, v.framework.hintAvailable, 'Framework hint', () => on.hint?.()),
        textForm({ id: 'ask', label: 'Ask a clarifying question', submit: 'Ask', onSubmit: t => on.ask?.(t) })
      ];
    case 'question':
      if (v.phase === 'answered') {
        const last = v.progress.index >= v.progress.total - 1;
        return [h('div', { class: 'row' }, btn(last ? 'Continue' : 'Next question', () => on.next?.(), { class: 'btn btn-primary', 'data-primary': '1' }))];
      }
      return [
        h('p', { class: 'step-label' }, `Question ${v.current.n} of ${v.progress.total}`),
        textForm({ id: 'ask', label: v.current.canAskData ? 'Ask for data or clarification' : 'Ask a clarifying question', submit: 'Ask', onSubmit: t => on.ask?.(t), note: 'Numbers are given only when you ask for them.' }),
        hintBlock(v, v.current.hintsLeft > 0, `Hint (${v.current.hintsLeft} left)`, () => on.hint?.()),
        textForm({ id: 'answer', label: 'Your answer', multiline: true, submit: 'Submit answer', onSubmit: t => on.submitAnswer?.(t), primary: true })
      ];
    case 'behavioral':
      return [
        textForm({ id: 'behavioral', label: 'Your response', multiline: true, submit: 'Submit response', onSubmit: t => on.submitBehavioral?.(t), primary: true }),
        h('div', { class: 'row' }, btn('Skip the behavioral question', () => on.skipBehavioral?.(), { class: 'btn btn-quiet' }))
      ];
    case 'recommendation':
      return [textForm({ id: 'recommendation', label: 'Your recommendation', multiline: true, submit: 'Give recommendation', onSubmit: t => on.submitRecommendation?.(t), primary: true })];
    case 'debrief':
      return [h('p', { class: 'step-label' }, 'Score each question below, then reveal the answers.')];
    case 'reveal':
      return [h('p', { class: 'step-label' }, 'Answers revealed. Adjust your scores if needed, then save.')];
    case 'skipped':
      return [h('p', { class: 'step-label' }, 'Case skipped. No score was recorded. Everything is shown below.')];
    default:
      return [];
  }
}

function hintBlock(v, available, label, onHint) {
  return h('div', { class: 'hint-block' }, [
    btn(label, onHint, { class: 'btn btn-quiet', disabled: !available, 'aria-describedby': 'hint-note' }),
    h('p', { class: 'field-note', id: 'hint-note' }, v.hintNote)
  ]);
}

function rubric(v, on, readOnly = false) {
  const d = v.debrief;
  const box = h('section', { class: 'panel rubric', 'aria-labelledby': 'rubric-title' }, [
    h('h2', { class: 'display', id: 'rubric-title' }, readOnly ? 'Your scores' : 'Debrief'),
    d.framework ? h('div', { class: 'your-answer' }, [h('p', { class: 'who' }, `Your framework${d.frameworkHints ? ` · ${d.frameworkHints} hint used` : ''}`), h('p', { class: 'msg-text' }, d.framework)]) : null
  ]);
  for (const q of d.questions) {
    box.append(h('fieldset', { class: 'rubric-q' }, [
      h('legend', {}, `Question ${q.n}`),
      h('p', { class: 'q-text' }, q.text),
      h('div', { class: 'your-answer' }, [h('p', { class: 'who' }, `Your answer${q.hintsUsed ? ` · ${q.hintsUsed} hint${q.hintsUsed > 1 ? 's' : ''} used` : ''}`), h('p', { class: 'msg-text' }, q.yourAnswer || '(no answer)')]),
      h('div', { class: 'checks' }, engine.RUBRIC.map(k => {
        const id = `rate-${q.n}-${k}`;
        return h('label', { class: 'check', for: id }, [
          h('input', { type: 'checkbox', id, checked: q.rubric[k] ? true : null, disabled: readOnly ? true : null, onchange: e => on.rate?.(q.n, k, e.target.checked) }),
          k[0].toUpperCase() + k.slice(1)
        ]);
      }))
    ]));
  }
  if (d.recommendation) box.append(h('div', { class: 'your-answer' }, [h('p', { class: 'who' }, 'Your recommendation'), h('p', { class: 'msg-text' }, d.recommendation)]));
  if (!readOnly) {
    box.append(h('div', { class: 'row' }, v.stage === 'debrief'
      ? btn('Reveal answers', () => on.reveal?.(), { class: 'btn btn-primary', 'data-primary': '1' })
      : btn('Save and finish', () => on.finish?.(), { class: 'btn btn-primary', 'data-primary': '1' })));
  }
  return box;
}

function scorePanel(v) {
  const s = v.score;
  return h('section', { class: 'panel score' }, [
    h('h2', { class: 'display' }, `${s.points} of ${s.max} points`),
    h('p', {}, `${s.pct}%${v.mode === 'practice' && (s.frameworkHints || s.questions.some(q => q.hints)) ? ', after hint deductions' : ''}. Saved to your progress on this device.`)
  ]);
}

function revealPanel(v) {
  const r = v.reveal;
  const sec = (title, body) => body ? h('section', { class: 'reveal-sec' }, [h('h3', {}, title), body]) : null;
  const para = t => t ? h('p', { class: 'msg-text' }, t) : null;
  return h('section', { class: 'panel reveal', 'aria-labelledby': 'reveal-title' }, [
    h('h2', { class: 'display', id: 'reveal-title' }, 'The full case'),
    sec('Prompt', para(r.prompt)),
    sec('Clarifying information', r.clarifyingFacts.length ? h('dl', { class: 'facts' }, r.clarifyingFacts.flatMap(f => [h('dt', {}, f.q), h('dd', {}, f.a)])) : null),
    sec('Framework hint', para(r.frameworkHint)),
    ...r.questions.map(q => h('section', { class: 'reveal-sec' }, [
      h('h3', {}, `Question ${q.n}`),
      para(q.text),
      q.framework.length ? h('table', { class: 'rows' }, [
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Figure'), h('th', { scope: 'col' }, 'Value'), h('th', { scope: 'col' }, 'Given on request')])),
        h('tbody', {}, q.framework.map(f => h('tr', {}, [h('td', {}, f.label), h('td', {}, f.value), h('td', {}, f.givenOnRequest ? 'Yes' : 'No')])))
      ]) : null,
      q.hints.length ? h('div', {}, [h('p', { class: 'who' }, 'Hints'), h('ul', {}, q.hints.map(x => h('li', {}, x)))]) : null,
      q.answer ? h('div', {}, [h('p', { class: 'who' }, 'Answer'), para(q.answer)]) : null,
      q.transition ? h('div', {}, [h('p', { class: 'who' }, 'Transition'), para(q.transition)]) : null,
      q.notes ? h('div', {}, [h('p', { class: 'who' }, 'Other notes'), para(q.notes)]) : null
    ])),
    sec('Behavioral question', para(r.behavioral)),
    sec('Recommendation', para(r.recommendation)),
    sec('Recap', para(r.recap))
  ]);
}

/* ======================= App controller (browser only) ======================= */
const app = { store: null, speech: null, session: null, report: null, filters: { industry: '', type: '', difficulty: '' }, exhibits: new Map(), confirmClear: false };
let main;
const now = () => new Date().toISOString();
const mount = (...nodes) => main.replaceChildren(...nodes.filter(Boolean));

function boot() {
  main = document.getElementById('cases-app');
  if (new URLSearchParams(location.search).has('test')) return runBrowserTests();
  app.store = createStore();
  const settings = app.store.settings();
  app.speech = createSpeech({
    onCaption: text => { if (app.ui?.caption) app.ui.caption.textContent = text; },
    onState: s => updateSpeechBar(s)
  });
  app.speech.setRate(settings.rate);
  app.speech.setEnabled(settings.readAloud);
  window.addEventListener('pagehide', () => app.speech.stop());
  renderLibrary();
}

/* ---------- library ---------- */
function renderLibrary() {
  app.session = null;
  app.speech?.stop();
  const { store } = app;
  const settings = store.settings();
  const lib = store.library();
  const progress = store.progress();
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, '');

  const file = h('input', { type: 'file', id: 'pdf-file', accept: 'application/pdf,.pdf' });
  file.addEventListener('change', () => { if (file.files[0]) onImport(file.files[0], status, file); });
  const side = h('select', { id: 'side-col', onchange: e => store.setSettings({ sideColumn: e.target.value }) },
    [['auto', 'Detect automatically'], ['right', 'Right column'], ['left', 'Left column'], ['none', 'No guidance column']]
      .map(([v, t]) => h('option', { value: v, selected: settings.sideColumn === v ? true : null }, t)));

  const tagsOf = id => store.tags(id);
  const diffOf = c => tagsOf(c.id).difficulty ?? c.difficulty ?? null;
  const uniq = key => [...new Set(lib.map(c => c[key]).filter(Boolean))].sort();
  const f = app.filters;
  const filtered = lib.filter(c => (!f.industry || c.industry === f.industry) && (!f.type || c.type === f.type) &&
    (!f.difficulty || (f.difficulty === 'untagged' ? !diffOf(c) : String(diffOf(c)) === f.difficulty)));

  const sel = (id, label, key, options) => h('div', { class: 'field' }, [
    h('label', { for: id }, label),
    h('select', { id, onchange: e => { app.filters[key] = e.target.value; renderLibrary(); document.getElementById(id)?.focus(); } },
      [h('option', { value: '' }, 'Any'), ...options.map(([v, t]) => h('option', { value: v, selected: f[key] === v ? true : null }, t))])
  ]);

  const statusOf = id => {
    const a = progress[id]?.attempts?.at(-1);
    if (!a) return 'New';
    return a.status === 'skipped' ? 'Skipped' : `Completed · ${a.score?.pct ?? 0}%`;
  };

  const caseRows = filtered.map(c => h('tr', {}, [
    h('th', { scope: 'row' }, [c.caseNumber ? h('span', { class: 'num' }, `${c.caseNumber}. `) : '', c.title || 'Untitled case',
      c.warnings?.length ? h('details', { class: 'warn' }, [h('summary', {}, `${c.warnings.length} import warning${c.warnings.length > 1 ? 's' : ''}`), h('ul', {}, c.warnings.map(w => h('li', {}, w)))]) : null]),
    h('td', {}, [c.industry, c.type].filter(Boolean).join(' | ') || '—'),
    h('td', {}, diffOf(c) ? String(diffOf(c)) : 'Untagged'),
    h('td', {}, statusOf(c.id)),
    h('td', { class: 'actions' }, [
      btn('Start', () => startCase(c.id), { class: 'btn btn-primary', 'aria-label': `Start ${c.title || 'case'}` }),
      btn('Tags', () => renderTagForm(store.getCase(c.id), { then: renderLibrary }), { class: 'btn btn-quiet', 'aria-label': `Edit tags for ${c.title || 'case'}` }),
      btn('Remove', () => { store.removeCase(c.id); renderLibrary(); }, { class: 'btn btn-quiet', 'aria-label': `Remove ${c.title || 'case'} from this browser` })
    ])
  ]));

  const history = Object.entries(progress).flatMap(([id, p]) => p.attempts.map(a => ({ id, ...a })))
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));

  const mode = h('select', { id: 'mode', onchange: e => store.setSettings({ mode: e.target.value }) },
    [['practice', 'Practice (hints cost points)'], ['study', 'Study (hints are free)']].map(([v, t]) => h('option', { value: v, selected: settings.mode === v ? true : null }, t)));
  const read = h('input', { type: 'checkbox', id: 'read-aloud', checked: settings.readAloud ? true : null, onchange: e => { store.setSettings({ readAloud: e.target.checked }); app.speech.setEnabled(e.target.checked); } });

  const progressFile = h('input', { type: 'file', id: 'progress-file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  progressFile.addEventListener('change', async () => {
    try { const n = store.importProgress(await progressFile.files[0].text()); renderLibrary(); announce(`Imported ${n} attempt${n === 1 ? '' : 's'}.`); }
    catch (err) { announce(err.message, true); }
  });

  mount(
    h('header', { class: 'page-head' }, [
      h('p', { class: 'eyebrow' }, 'Practice room'),
      h('h1', { class: 'display' }, 'Case interview practice'),
      h('p', { class: 'lede' }, 'Import your own casebook PDF and run its cases as a mock interview. The PDF is read in this browser and stays on this device.')
    ]),
    h('p', { class: 'status', id: 'announce', role: 'status', 'aria-live': 'polite' }),
    app.speech.supported ? null : h('p', { class: 'banner', role: 'note' }, "This browser can't read text aloud. The interviewer's lines will appear as text instead."),

    h('section', { class: 'panel', 'aria-labelledby': 'import-title' }, [
      h('h2', { class: 'display', id: 'import-title' }, 'Import a casebook'),
      h('div', { class: 'grid-2' }, [
        h('div', { class: 'field' }, [h('label', { for: 'pdf-file' }, 'Casebook PDF'), file]),
        h('div', { class: 'field' }, [h('label', { for: 'side-col' }, 'Interviewer guidance column'), side])
      ]),
      h('p', { class: 'field-note' }, 'Nothing is uploaded. Parsed cases are saved in this browser only.'),
      status,
      app.report ? reportView(app.report) : null
    ]),

    h('section', { class: 'panel', 'aria-labelledby': 'pick-title' }, [
      h('h2', { class: 'display', id: 'pick-title' }, 'Pick a case'),
      lib.length ? h('div', { class: 'filters' }, [
        sel('f-industry', 'Industry', 'industry', uniq('industry').map(x => [x, x])),
        sel('f-type', 'Type', 'type', uniq('type').map(x => [x, x])),
        sel('f-diff', 'Difficulty', 'difficulty', [['1', '1'], ['2', '2'], ['3', '3'], ['untagged', 'Untagged']]),
        h('div', { class: 'field' }, [h('span', { class: 'label-like', 'aria-hidden': 'true' }, ' '), btn('Random case', () => randomCase(filtered, progress), { class: 'btn btn-primary', disabled: !filtered.length })])
      ]) : null,
      lib.length ? h('div', { class: 'grid-2 settings' }, [
        h('div', { class: 'field' }, [h('label', { for: 'mode' }, 'Mode'), mode]),
        h('div', { class: 'field check' }, [read, h('label', { for: 'read-aloud' }, 'Read the interviewer aloud')])
      ]) : null,
      lib.length
        ? (filtered.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'cases' }, [
            h('caption', { class: 'visually-hidden' }, 'Cases in this browser'),
            h('thead', {}, h('tr', {}, ['Case', 'Industry | Type', 'Difficulty', 'Status', 'Actions'].map(t => h('th', { scope: 'col' }, t)))),
            h('tbody', {}, caseRows)
          ])) : h('p', { class: 'empty' }, 'No cases match these filters.'))
        : h('p', { class: 'empty' }, 'No cases yet. Import a casebook PDF above to get started.')
    ]),

    h('section', { class: 'panel', 'aria-labelledby': 'history-title' }, [
      h('h2', { class: 'display', id: 'history-title' }, 'Completed and skipped'),
      history.length ? h('ul', { class: 'history' }, history.map(a => {
        const c = lib.find(x => x.id === a.id);
        return h('li', {}, [
          h('span', { class: 'h-title' }, c ? c.title || 'Untitled case' : `Case not in this browser (${a.id})`),
          h('span', { class: `chip ${a.status}` }, a.status === 'skipped' ? 'Skipped' : `${a.score?.points ?? 0}/${a.score?.max ?? 0} · ${a.score?.pct ?? 0}%`),
          h('time', { datetime: a.finishedAt || '' }, a.finishedAt ? new Date(a.finishedAt).toLocaleString() : '')
        ]);
      })) : h('p', { class: 'empty' }, 'Nothing yet.'),
      h('div', { class: 'row' }, [
        btn('Export progress', exportProgress, { class: 'btn btn-quiet' }),
        h('label', { class: 'btn btn-quiet', for: 'progress-file', tabindex: '0', role: 'button', onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); progressFile.click(); } } }, 'Import progress'),
        progressFile,
        btn(app.confirmClear ? 'Click again to delete everything' : 'Delete all case data', async () => {
          if (!app.confirmClear) { app.confirmClear = true; renderLibrary(); document.querySelector('.btn-danger')?.focus(); return; }
          app.confirmClear = false; store.clearAll(); await forgetPdfs(); app.report = null; renderLibrary(); announce('All case data was deleted from this browser.');
        }, { class: 'btn btn-quiet btn-danger' })
      ]),
      h('p', { class: 'field-note' }, 'The export holds case IDs, completed or skipped status, scores and dates. It contains no case text.')
    ])
  );
}

function announce(text, error = false) {
  const el = document.getElementById('announce');
  if (el) { el.textContent = text; el.classList.toggle('is-error', error); }
}

function reportView(r) {
  return h('div', { class: 'report' }, [
    h('p', {}, `${r.cases.length} case${r.cases.length === 1 ? '' : 's'} found in ${r.name}.`),
    r.warnings.length ? h('details', { class: 'warn' }, [
      h('summary', {}, `${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''}`),
      h('ul', {}, r.warnings.map(w => h('li', {}, `${w.title || 'Case'}: ${w.message}`)))
    ]) : h('p', {}, 'No warnings.')
  ]);
}

async function onImport(file, status, input) {
  const say = (t, err = false) => { status.textContent = t; status.classList.toggle('is-error', err); };
  input.disabled = true;
  try {
    say(`Reading ${file.name}…`);
    const { bytes, numPages, pages: raw } = await readPdf(file, { onProgress: (n, t) => say(`Reading page ${n} of ${t}…`) });
    const sourceId = sourceIdFor(file.name, file.size, numPages);
    const pages = buildPages(raw, { sideColumn: app.store.settings().sideColumn });
    const { cases, warnings } = parseCasebook(pages, { source: { id: sourceId, name: file.name } });
    if (cases.length) app.store.saveCases(cases);
    await rememberPdf(sourceId, bytes);
    app.report = { name: file.name, cases: cases.map(c => ({ id: c.id, title: c.title })), warnings };
    renderLibrary();
    announce(cases.length ? `Imported ${cases.length} case${cases.length === 1 ? '' : 's'} from ${file.name}.` : `No cases were found in ${file.name}.`, !cases.length);
  } catch (err) {
    say(err.message || 'The PDF could not be read.', true);
    input.disabled = false;
  }
}

function exportProgress() {
  const data = app.store.exportProgress(now());
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `case-practice-progress-${now().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function randomCase(filtered, progress) {
  const fresh = filtered.filter(c => !progress[c.id]?.attempts?.length);
  const pool = fresh.length ? fresh : filtered;
  if (pool.length) startCase(pool[Math.floor(Math.random() * pool.length)].id);
}

/* ---------- tagging ---------- */
function startCase(id) {
  const c = app.store.getCase(id);
  if (!c) return;
  const req = engine.tagRequest(c, app.store.tags(id));
  if (req.needed) renderTagForm(c, { then: () => beginSession(id), required: req });
  else beginSession(id);
}

function renderTagForm(c, { then, required = null }) {
  const t = app.store.tags(c.id);
  const level = (name, label, labels, value) => h('fieldset', { class: 'levels' }, [
    h('legend', {}, label),
    ...[1, 2, 3].map(n => h('label', { class: 'check' }, [
      h('input', { type: 'radio', name, value: String(n), required: true, checked: value === n ? true : null }),
      `${n} · ${labels[n - 1]}`
    ]))
  ]);
  const qsWithRows = c.questions.filter(q => q.framework?.length);
  const reveal = h('input', { type: 'checkbox', id: 'show-values', onchange: e => form.classList.toggle('show-values', e.target.checked) });

  const form = h('form', {
    class: 'panel tag-form',
    onsubmit: e => {
      e.preventDefault();
      const fd = new FormData(form);
      const rows = {};
      for (const q of qsWithRows) q.framework.forEach((r, i) => { rows[engine.rowKey(q.n, i)] = fd.get(`row-${q.n}-${i}`) === 'on'; });
      const exhibits = {};
      for (const ex of c.exhibits) { const d = String(fd.get(`ex-${ex.n}`) || '').trim(); if (d) exhibits[ex.n] = d; }
      app.store.setTags(c.id, {
        difficulty: +fd.get('difficulty'), math: +fd.get('math'), creativity: +fd.get('creativity'),
        rows, rowsTagged: true, exhibits, ...(c.recap ? {} : { recap: String(fd.get('recap') || '').trim() })
      });
      then();
    }
  }, [
    h('p', { class: 'eyebrow' }, required ? 'Before you start' : 'Edit tags'),
    h('h1', { class: 'display' }, c.title || 'Untitled case'),
    h('p', { class: 'lede' }, "Difficulty, math and creativity aren't in the PDF, so you set them once. They're saved on this device."),
    h('div', { class: 'grid-3' }, [
      level('difficulty', 'Difficulty', ['Easy', 'Medium', 'Hard'], t.difficulty ?? c.difficulty),
      level('math', 'Math', ['Light', 'Moderate', 'Heavy'], t.math ?? c.tags?.math),
      level('creativity', 'Creativity', ['Low', 'Medium', 'High'], t.creativity ?? c.tags?.creativity)
    ]),
    h('h2', { class: 'display' }, 'Numbers given on request'),
    qsWithRows.length ? h('div', {}, [
      h('p', { class: 'field-note' }, 'Tick the figures the interviewer gives only when asked (the gray rows in your casebook). The rest stay hidden until the debrief.'),
      h('div', { class: 'field check' }, [reveal, h('label', { for: 'show-values' }, 'Show the values (spoilers)')]),
      ...qsWithRows.map(q => h('fieldset', { class: 'rows-tag' }, [
        h('legend', {}, `Question ${q.n}`),
        ...q.framework.map((r, i) => h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', name: `row-${q.n}-${i}`, checked: (t.rows ? t.rows[engine.rowKey(q.n, i)] : r.givenOnRequest) ? true : null }),
          h('span', {}, r.label), h('span', { class: 'spoiler' }, r.value)
        ]))
      ]))
    ]) : h('p', { class: 'field-note' }, 'No figure rows were found in this case.'),
    c.exhibits.length ? h('div', {}, [
      h('h2', { class: 'display' }, 'Exhibit descriptions (optional)'),
      h('p', { class: 'field-note' }, 'Written descriptions are read aloud when the exhibit appears.'),
      ...c.exhibits.map(ex => h('div', { class: 'field' }, [
        h('label', { for: `ex-${ex.n}` }, `Exhibit ${ex.n}${ex.page ? ` (PDF page ${ex.page})` : ''}`),
        h('textarea', { id: `ex-${ex.n}`, name: `ex-${ex.n}`, rows: 2, value: t.exhibits?.[ex.n] || '' })
      ]))
    ]) : null,
    c.recap ? null : h('div', { class: 'field' }, [
      h('h2', { class: 'display' }, 'Recap (optional)'),
      h('label', { for: 'recap' }, 'No recap was found in the PDF. Write one for the debrief if you like.'),
      h('textarea', { id: 'recap', name: 'recap', rows: 3, value: t.recap || '' })
    ]),
    h('div', { class: 'row' }, [
      h('button', { type: 'submit', class: 'btn btn-primary' }, required ? 'Save and start' : 'Save tags'),
      btn('Cancel', renderLibrary, { class: 'btn btn-quiet' })
    ])
  ]);
  main.replaceChildren(form);
  form.querySelector('input[name="difficulty"]')?.focus();
}

/* ---------- session ---------- */
function beginSession(id) {
  const c = engine.applyTags(app.store.getCase(id), app.store.tags(id));
  const { state, out } = engine.start(c, { mode: app.store.settings().mode, at: now() });
  app.session = { c, state };
  renderSession();
  speakAll(out);
}

function act(type, extra = {}) {
  if (!app.session) return;
  const { c, state } = app.session;
  const { state: next, out } = engine.dispatch(c, state, { type, ...extra, at: now() });
  if (next === state) return;
  app.session.state = next;
  if (next.stage === 'done' && state.stage !== 'done') {
    app.store.recordAttempt(c.id, { status: 'completed', startedAt: next.startedAt, finishedAt: next.finishedAt, score: engine.score(c, next) });
  }
  if (next.stage === 'skipped' && state.stage !== 'skipped') {
    app.speech.stop();
    app.store.recordAttempt(c.id, { status: 'skipped', startedAt: next.startedAt, finishedAt: next.finishedAt, score: null });
  }
  renderSession();
  speakAll(out);
}

const handlers = {
  ask: t => act('ask', { text: t }),
  toFramework: () => act('toFramework'),
  hint: () => act('hint'),
  submitFramework: t => act('submitFramework', { text: t }),
  submitAnswer: t => act('submitAnswer', { text: t }),
  next: () => act('next'),
  submitBehavioral: t => act('submitBehavioral', { text: t }),
  skipBehavioral: () => act('skipBehavioral'),
  submitRecommendation: t => act('submitRecommendation', { text: t }),
  rate: (n, key, value) => act('rate', { n, key, value }),
  reveal: () => act('reveal'),
  finish: () => act('finish'),
  skip: () => act('skip'),
  exit: () => renderLibrary()
};

function renderSession() {
  const { c, state } = app.session;
  const activeId = document.activeElement?.id;
  const v = engine.view(c, state);
  const view = renderView(v, handlers);
  main.replaceChildren(speechBar(), view);
  const list = view.querySelector('.transcript');
  if (list) list.scrollTop = list.scrollHeight;
  const keep = activeId && document.getElementById(activeId);
  const target = keep && !keep.disabled && (keep.matches('input[type="checkbox"]') || keep.id === 'ask') ? keep : view.querySelector('[data-primary]') || view.querySelector('#ask') || view.querySelector('.head-actions .btn');
  target?.focus();
  fillExhibits(view, c);
}

function speakAll(out) { for (const o of out) app.speech.speak(o.speak); }

function speechBar() {
  const s = app.speech;
  const ui = app.ui = {};
  const settings = app.store.settings();
  ui.play = btn('Repeat', () => s.replay(), { class: 'btn btn-quiet', 'aria-label': 'Read the last line again' });
  ui.pause = btn('Pause', () => s.pause(), { class: 'btn btn-quiet' });
  ui.resume = btn('Resume', () => s.resume(), { class: 'btn btn-quiet' });
  ui.stop = btn('Stop', () => s.stop(), { class: 'btn btn-quiet' });
  const rate = h('select', { id: 'rate', onchange: e => { s.setRate(e.target.value); app.store.setSettings({ rate: +e.target.value }); } },
    [0.8, 1, 1.2, 1.5].map(r => h('option', { value: String(r), selected: settings.rate === r ? true : null }, `${r}×`)));
  const on = h('input', { type: 'checkbox', id: 'read-toggle', checked: s.enabled ? true : null, onchange: e => { s.setEnabled(e.target.checked); app.store.setSettings({ readAloud: e.target.checked }); updateSpeechBar(s.state); } });
  ui.caption = h('p', { class: 'caption' }, '');
  const bar = h('div', { class: 'speech-bar', role: 'group', 'aria-label': 'Read aloud' }, s.supported ? [
    h('div', { class: 'field check' }, [on, h('label', { for: 'read-toggle' }, 'Read aloud')]),
    ui.play, ui.pause, ui.resume, ui.stop,
    h('div', { class: 'field inline' }, [h('label', { for: 'rate' }, 'Speed'), rate]),
    ui.caption
  ] : [h('p', { class: 'banner' }, "This browser can't read text aloud, so the interviewer's lines appear as text only.")]);
  updateSpeechBar(s.state);
  return bar;
}

function updateSpeechBar(state) {
  const ui = app.ui;
  if (!ui?.pause) return;
  const enabled = app.speech.enabled;
  ui.play.disabled = !enabled;
  ui.pause.disabled = !enabled || state !== 'speaking';
  ui.resume.disabled = !enabled || state !== 'paused';
  ui.stop.disabled = !enabled || state === 'idle';
  if (state === 'idle' && ui.caption) ui.caption.textContent = '';
}

/* ---------- exhibits: page images rendered from the PDF kept on this device ---------- */
async function fillExhibits(root, c) {
  for (const fig of root.querySelectorAll('figure.exhibit[data-page]')) {
    const page = +fig.dataset.page;
    const box = fig.querySelector('.exhibit-img');
    if (!page) continue;
    const key = `${c.source?.id}:${page}`;
    try {
      let url = app.exhibits.get(key);
      if (!url) {
        const bytes = await recallPdf(c.source?.id);
        if (!bytes) { box.replaceChildren(reopenPrompt(c)); continue; }
        const doc = await openPdf(c.source.id, bytes);
        url = await renderPageImage(doc, page, 900);
        app.exhibits.set(key, url);
      }
      if (!box.isConnected) return;
      box.replaceChildren(h('img', { src: url, alt: `Exhibit ${fig.dataset.n}, page ${page} of ${c.source?.name || 'the imported PDF'}` }));
    } catch (err) {
      box.textContent = `Couldn't show page ${page}: ${err.message}`;
    }
  }
}

function reopenPrompt(c) {
  const id = `reopen-${Math.random().toString(36).slice(2, 7)}`;
  const input = h('input', { type: 'file', id, accept: 'application/pdf,.pdf' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    await rememberPdf(c.source.id, new Uint8Array(await f.arrayBuffer()));
    if (app.session) renderSession();
  });
  return h('div', { class: 'reopen' }, [
    h('p', {}, `The PDF isn't stored in this browser. Choose ${c.source?.name || 'the casebook PDF'} again to show this exhibit.`),
    h('label', { for: id }, 'Casebook PDF'), input
  ]);
}

/* ---------- ?test ---------- */
async function runBrowserTests() {
  main.replaceChildren(h('p', { class: 'loading' }, 'Running tests…'));
  const { runTests } = await import('../tests/tests.js');
  const results = await runTests({ render: v => renderView(v, {}) });
  const passed = results.filter(r => r.pass).length;
  main.replaceChildren(
    h('h1', { class: 'display' }, `Tests: ${passed} of ${results.length} passed`),
    h('ul', { class: 'tests' }, results.map(r => h('li', { class: r.pass ? 'pass' : 'fail' }, [
      h('strong', {}, `${r.pass ? 'PASS' : 'FAIL'} ${r.name}`), h('p', {}, r.details)
    ])))
  );
}

if (typeof document !== 'undefined' && document.body?.dataset.app === 'cases') boot();
