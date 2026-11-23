// Tests for the case practice app. Fixtures are fictional and built in code; no PDFs are used.
// Browser: cases/index.html?test     Node: node cases/tests/tests.js
import { buildPages } from '../js/pdf-import.js';
import { parseCasebook, matchByKeywords } from '../js/parser.js';
import * as engine from '../js/engine.js';
import { createStore, memoryStorage, buildProgressExport } from '../js/store.js';

/* ---------- fictional fixture: a two-column casebook, 3 pages ---------- */
const W = 612, H = 792;
const item = (str, x, y, size = 10) => ({ str, x, y, w: str.length * size * 0.5, h: size });
function page(n, left, right) {
  const items = [item('Fictional Practice Casebook', 50, 32, 9), item(String(n), 300, 765, 9)];
  left.forEach((t, i) => items.push(item(t, 50, 110 + i * 16)));
  right.forEach((t, i) => items.push(item(t, 400, 110 + i * 16)));
  return { page: n, width: W, height: H, items };
}
export const FIXTURE = [
  page(1, [
    'Case 10: EXAMPLE CASE',
    'Consumer | Market Sizing',
    'Prompt',
    'Our client, Lantern Bikes, is a fictional e-bike maker.',
    'It wants to know how many e-bikes are sold each year in',
    'the fictional city of Port Avalon.'
  ], [
    'Clarifying Information',
    '1. What is the client\'s goal? To size',
    'the yearly e-bike market.',
    '2. What timeframe matters? One year.'
  ]),
  page(2, [
    'Question 1: How many e-bikes are sold in',
    'Port Avalon each year?'
  ], [
    'Figures',
    '• Population: 800,000',
    '• Households: 320,000',
    'Hint',
    'Start from households.',
    'Answer',
    'About 9,600 e-bikes per year.',
    'Transition',
    'Now let us look at revenue.'
  ]),
  page(3, [
    'Question 2: What revenue could the client',
    'earn with a 10% share?',
    'Behavioral Question',
    'Tell me about a time you changed your mind.',
    'Recommendation',
    'Enter with a premium model in year one.'
  ], [
    'Answer',
    'About $1.9 million a year.',
    'Hint',
    'Use the average price per bike.',
    '• Average price: $2,000',
    'Recap',
    'Households drive demand here.'
  ])
];
const SECRETS = ['9,600', '1.9 million', 'Start from households', 'Use the average price', '800,000', '320,000', '2,000', 'Now let us look at revenue', 'premium model', 'Households drive demand', 'To size', 'One year'];

function parsedFixture(opts) {
  const pages = buildPages(FIXTURE, opts);
  return { pages, ...parseCasebook(pages, { source: { id: 'pdf-test', name: 'fixture.pdf' } }) };
}
const TAGS = { difficulty: 2, math: 2, creativity: 1, rowsTagged: true, rows: { '1:0': true, '1:1': false, '2:0': true } };

/* ---------- runner ---------- */
export async function runTests({ render = null } = {}) {
  const results = [];
  const add = (name, pass, details) => results.push({ name, pass: !!pass, details });
  const tryTest = (name, fn) => { try { fn(); } catch (err) { add(name, false, `Threw: ${err.message}`); } };

  // 1. Two-column layout: guidance column kept separate, running headers and page numbers removed.
  tryTest('1. Two-column page: guidance column separate, headers and footers removed', () => {
    const { pages, cases } = parsedFixture();
    const all = pages.flatMap(p => p.lines.map(l => l.text));
    const problems = [];
    if (all.some(t => /Fictional Practice Casebook/.test(t))) problems.push('running header kept');
    if (all.some(t => /^\d+$/.test(t))) problems.push('page number kept');
    const p2 = pages[1];
    if (p2.columns?.side !== 'right') problems.push(`guidance column detected as ${p2.columns?.side}`);
    const main2 = p2.lines.filter(l => l.col === 'main').map(l => l.text).join(' ');
    const side2 = p2.lines.filter(l => l.col === 'side').map(l => l.text).join(' ');
    if (/9,600|Population/.test(main2)) problems.push('guidance text leaked into the main column');
    if (!/How many e-bikes/.test(main2)) problems.push('question text missing from the main column');
    if (!/About 9,600/.test(side2)) problems.push('answer missing from the guidance column');
    const c = cases[0];
    if (c?.title !== 'EXAMPLE CASE' || c.caseNumber !== '10') problems.push(`title/number ${c?.title}/${c?.caseNumber}`);
    if (c?.industry !== 'Consumer' || c.type !== 'Market Sizing') problems.push(`subtitle ${c?.industry} | ${c?.type}`);
    if (!/Lantern Bikes/.test(c?.prompt) || /goal|To size/.test(c?.prompt)) problems.push('prompt mixed with guidance');
    const q1 = c?.questions[0];
    if (!/How many e-bikes are sold in Port Avalon each year\?/.test(q1?.text) || /Population/.test(q1?.text)) problems.push(`Q1 text: ${q1?.text}`);
    if (!/9,600/.test(q1?.answer) || q1?.hints[0] !== 'Start from households.' || q1?.transition !== 'Now let us look at revenue.') problems.push('Q1 guidance sections wrong');
    if (q1?.framework.map(r => `${r.label}=${r.value}`).join('|') !== 'Population=800,000|Households=320,000') problems.push(`Q1 rows ${JSON.stringify(q1?.framework)}`);
    const q2 = c?.questions[1];
    if (q2?.framework[0]?.label !== 'Average price') problems.push('unlabelled bulleted figure under a hint was not read as a row');
    if (c?.clarifyingFacts.length !== 2) problems.push(`${c?.clarifyingFacts.length} clarifying facts`);
    add('1. Two-column page: guidance column separate, headers and footers removed', !problems.length,
      problems.length ? problems.join('; ') : 'Header and page numbers removed on all 3 pages. Right column detected as guidance. Prompt, question text, figures, hints, answers, transitions, recap and recommendation all land in the right fields.');
  });

  // 2. Clarifying questions: keyword match returns the fact; unknown questions get the not-in-materials line.
  tryTest('2. Clarifying matching', () => {
    const c = engine.applyTags(parsedFixture().cases[0], TAGS);
    const goal = c.clarifyingFacts[0];
    const problems = [];
    if (!goal.keywords.includes('goal') || !goal.keywords.includes('client')) problems.push(`keywords ${goal.keywords}`);
    const ask = text => engine.dispatch(c, engine.start(c).state, { type: 'ask', text }).out[0]?.speak;
    const hit = ask("What's the client's main goal here?");
    const hit2 = ask('Which timeframe should I use?');
    const miss = ask('What is the weather like in Port Avalon?');
    if (hit !== goal.a) problems.push(`goal question returned "${hit}"`);
    if (hit2 !== c.clarifyingFacts[1].a) problems.push(`timeframe question returned "${hit2}"`);
    if (miss !== engine.NOT_IN_MATERIALS) problems.push(`unknown question returned "${miss}"`);
    if (matchByKeywords(c.clarifyingFacts, 'hello there', f => f.keywords).length) problems.push('greeting matched a fact');
    add('2. Clarifying matching', !problems.length, problems.length ? problems.join('; ')
      : `"client's main goal" → the goal fact. "Which timeframe" → the timeframe fact. "weather" → "${engine.NOT_IN_MATERIALS}" Facts are only returned when asked.`);
  });

  // 3. Hidden content: nothing appears in the view (or the rendered page) before its stage.
  tryTest('3. Answers, hints and on-request numbers stay hidden until their stage', () => {
    const c = engine.applyTags(parsedFixture().cases[0], TAGS);
    const problems = [];
    const rendered = v => {
      let s = JSON.stringify(v);
      if (render) { const el = render(v); s += '\n' + el.textContent + el.innerHTML; }
      return s;
    };
    const check = (label, v, hidden, shown = []) => {
      const text = rendered(v);
      for (const x of hidden) if (text.includes(x)) problems.push(`${label}: "${x}" visible too early`);
      for (const x of shown) if (!text.includes(x)) problems.push(`${label}: "${x}" should be visible`);
    };
    let { state: s } = engine.start(c, { at: '2026-01-01T00:00:00Z' });
    const step = a => { s = engine.dispatch(c, s, a).state; return engine.view(c, s); };
    check('intro', engine.view(c, s), SECRETS, ['Lantern Bikes']);
    check('framework', step({ type: 'toFramework' }), SECRETS);
    check('question 1', step({ type: 'submitFramework', text: 'Households × ownership × replacement' }), SECRETS, ['How many e-bikes']);
    check('after an unrelated ask', step({ type: 'ask', text: 'What colour are the bikes?' }), SECRETS);
    check('after asking for population', step({ type: 'ask', text: 'What is the population?' }), SECRETS.filter(x => x !== '800,000'), ['800,000']);
    check('after hint', step({ type: 'hint' }), SECRETS.filter(x => !['800,000', 'Start from households'].includes(x)), ['Start from households']);
    check('after answer', step({ type: 'submitAnswer', text: 'Roughly ten thousand' }), ['9,600', '320,000', '1.9 million', 'premium model'], ['Now let us look at revenue']);
    check('question 2', step({ type: 'next' }), ['9,600', '320,000', '1.9 million', 'Use the average price', '2,000', 'premium model']);
    step({ type: 'submitAnswer', text: 'About two million' });
    check('behavioral', step({ type: 'next' }), ['9,600', '320,000', '1.9 million', 'premium model', 'Households drive demand'], ['changed your mind']);
    step({ type: 'submitBehavioral', text: 'A story.' });
    check('debrief', step({ type: 'submitRecommendation', text: 'Enter the market.' }), ['9,600', '320,000', '1.9 million', 'Households drive demand'], ['premium model']);
    check('reveal', step({ type: 'reveal' }), [], ['9,600', '320,000', '1.9 million', 'Households drive demand']);
    // Skip reveals everything at once.
    const sk = engine.dispatch(c, engine.start(c).state, { type: 'skip', at: '2026-01-01T00:05:00Z' }).state;
    check('skip', engine.view(c, sk), [], ['9,600', '1.9 million', '320,000']);
    add('3. Answers, hints and on-request numbers stay hidden until their stage', !problems.length,
      problems.length ? problems.slice(0, 6).join('; ')
        : `Checked 12 stages${render ? ' in the view and the rendered page' : ' in the view object'}. Numbers appear only after asking by keyword, hints only after Hint, answers only at reveal or skip.`);
  });

  // 4. Missing tags produce a tag request, not an error.
  tryTest('4. Missing difficulty produces a tag request', () => {
    const c = parsedFixture().cases[0];
    const req = engine.tagRequest(c, {});
    const req2 = engine.tagRequest(c, TAGS);
    const problems = [];
    if (!req.needed || !req.fields.includes('difficulty')) problems.push(`no tag request: ${JSON.stringify(req)}`);
    if (!req.fields.includes('givenOnRequest')) problems.push('figure rows not requested');
    if (req2.needed) problems.push(`still asks after tagging: ${req2.fields}`);
    // a case with no rows and nothing parsed still doesn't throw
    const bare = { id: 'bare', title: '', questions: [], exhibits: [], clarifyingFacts: [] };
    const req3 = engine.tagRequest(bare, undefined);
    if (!req3.fields.includes('difficulty')) problems.push('bare case not handled');
    add('4. Missing difficulty produces a tag request', !problems.length, problems.length ? problems.join('; ')
      : `Untagged case → asks for ${req.fields.join(', ')}. Once tagged → no request. An empty case also returns a request instead of throwing.`);
  });

  // 5. Progress export holds ids, status, scores and timestamps only.
  tryTest('5. Progress export contains no case text', () => {
    const c = engine.applyTags(parsedFixture().cases[0], TAGS);
    const store = createStore(memoryStorage());
    let s = engine.start(c, { at: '2026-01-01T00:00:00Z' }).state;
    for (const a of [{ type: 'toFramework' }, { type: 'submitFramework', text: 'secret framework words' }, { type: 'submitAnswer', text: 'my private answer' }, { type: 'next' }, { type: 'submitAnswer', text: 'x' }, { type: 'next' }, { type: 'skipBehavioral' }, { type: 'submitRecommendation', text: 'go' }, { type: 'rate', n: 1, key: 'math', value: true }, { type: 'reveal' }, { type: 'finish', at: '2026-01-01T00:20:00Z' }]) s = engine.dispatch(c, s, a).state;
    // try to sneak text in through extra fields; the export must drop them
    store.recordAttempt(c.id, { status: 'completed', startedAt: s.startedAt, finishedAt: s.finishedAt, score: { ...engine.score(c, s), note: c.prompt }, prompt: c.prompt });
    store.recordAttempt(c.id, { status: 'skipped', startedAt: '2026-01-02T00:00:00Z', finishedAt: '2026-01-02T00:01:00Z', score: null });
    const exp = store.exportProgress('2026-01-03T00:00:00Z');
    const json = JSON.stringify(exp);
    const problems = [];
    const words = ['Lantern', 'Port Avalon', 'e-bike', 'households', 'premium', 'secret framework', 'private answer', ...SECRETS];
    for (const w of words) if (json.toLowerCase().includes(w.toLowerCase())) problems.push(`"${w}" found in export`);
    const allowed = new Set(['format', 'version', 'exportedAt', 'cases', 'id', 'attempts', 'status', 'startedAt', 'finishedAt', 'score', 'points', 'max', 'pct', 'frameworkHints', 'questions', 'n', 'hints', 'structure', 'math', 'synthesis', 'communication']);
    const walk = (o, path) => {
      if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (o && typeof o === 'object') return Object.entries(o).forEach(([k, v]) => { if (!allowed.has(k)) problems.push(`unexpected field ${path}.${k}`); walk(v, `${path}.${k}`); });
      if (typeof o === 'string') {
        const ok = /^\d{4}-\d\d-\d\dT/.test(o) || ['completed', 'skipped', 'case-practice-progress'].includes(o) || (path.endsWith('.id') && /^[a-z0-9-]+$/.test(o));
        if (!ok) problems.push(`string at ${path}: "${o.slice(0, 30)}"`);
      }
    };
    walk(exp, 'export');
    if (exp.cases[0]?.attempts.length !== 2) problems.push('attempts missing');
    if (exp.cases[0]?.attempts[1].score !== null) problems.push('skipped attempt has a score');
    // round trip
    const other = createStore(memoryStorage());
    const added = other.importProgress(json);
    if (added !== 2) problems.push(`re-import added ${added}`);
    add('5. Progress export contains no case text', !problems.length, problems.length ? problems.slice(0, 6).join('; ')
      : `Export has only ids, status, scores and timestamps (checked every field). Extra text slipped into an attempt was dropped. Re-import restores ${added} attempts. Note: the id includes a slug of the title, as specified.`);
  });

  // 6. Missing required pieces become warnings, never guesses.
  tryTest('6. Missing pieces become warnings', () => {
    const pages = buildPages([page(1, ['EXAMPLE CASE', 'Some opening text with no heading.', 'Question 1: What now?'], ['Hint', 'Think.'])]);
    const { cases } = parseCasebook(pages);
    const c = cases[0];
    const w = c.warnings.join(' | ');
    const problems = [];
    if (c.prompt) problems.push('prompt was guessed from unlabelled text');
    for (const need of ['subtitle', 'prompt', 'Clarifying', 'Answer', 'recommendation']) if (!w.toLowerCase().includes(need.toLowerCase())) problems.push(`no warning about ${need}`);
    add('6. Missing pieces become warnings', !problems.length, problems.length ? problems.join('; ') : `${c.warnings.length} warnings, no guessed content.`);
  });

  // 7. Guidance placed above its question on the same page still attaches to that question.
  tryTest('7. Guidance beside a question attaches to it', () => {
    const pages = buildPages([
      page(1, ['Case 3: SAMPLE CASE', 'Retail | Pricing', 'Prompt', 'A fictional shop wants a new price.', '', '', 'Question 1: What price should it set?'],
              ['Answer', 'About $12, a fictional figure.', 'Hint', 'Think about rivals.']),
      page(2, ['Question 2: What volume follows?', '', '', '', 'Question 3: Is it worth it?'],
              ['Answer', 'Around 4,000 units.', 'Transition', 'Last question.', 'Answer', 'Yes, it is worth it.'])
    ]);
    const c = parseCasebook(pages).cases[0];
    const got = c.questions.map(q => `${q.n}:${q.answer}`).join(' | ');
    const ok = got === '1:About $12, a fictional figure. | 2:Around 4,000 units. | 3:Yes, it is worth it.' && c.questions[0].hints[0] === 'Think about rivals.';
    add('7. Guidance beside a question attaches to it', ok, ok ? 'Guidance above the first question, and a second Answer above the next question on the same page, both attach to the right question.' : got);
  });

  // 8. Slide-style casebooks: running "N | CASE: TITLE" header, letter-spaced and doubled text, named stages,
  //    guidance headings, "Provide if asked" figures, a conclusion prompt, and a feedback form after the case.
  tryTest('8. Slide-style layout: headers, stages, guidance and figures', () => {
    const slide = (n, left, right = [], header = true) => {
      const pg = page(n, left, right);
      if (header) pg.items.push(item('0 3', 50, 60), item('|', 75, 60), item('C A S E :', 85, 60), item('L A N T E R N', 140, 60), item('B I K E S', 220, 60), item('L A N T E R N', 140, 60));
      return pg;
    };
    const pages = buildPages([
      slide(1, ['LANTERN BIKES', 'Consumer | Growth  •  Skills Tested: sizing', 'Prompt:', 'A fictional maker of e-bikes wants to grow.', 'Clarifying Information: Note: Provide this only if asked.', '1. What is the goal? Double sales.', 'Market: Small and fragmented.'], ['B E H A V I O R A L', 'I N T E R V I E W', 'Q U E S T I O N :', 'Tell me about a team you led.']),
      slide(2, ['Framework Guidance:', 'Revenue and costs.']),
      slide(3, ['EXHIBIT 1', 'Sales by year (fictional)']),
      slide(4, ['Question 1 (place these slides where you like)', '• What does the exhibit show?', '', 'Exhibit or Question Guidance:', 'Sales are flat.'], ['Provide if asked:', '• Units: 4,000', 'Best candidates:', 'Spot the flat trend.']),
      slide(5, ['BRAINSTORMING', 'How could the client grow?', '', 'Brainstorming Guidance:', 'New cities, new models.']),
      slide(6, ['CONCLUSION', 'What should the client do?', 'Recommendation:', '• Launch in two new cities.', 'Risks:', '• Weather.']),
      slide(7, ['INTERVIEWER FEEDBACK FORM', 'Structure 1 2 3 4 5'])
    ]);
    const { cases } = parseCasebook(pages);
    const c = cases[0];
    const problems = [];
    if (cases.length !== 1) problems.push(`${cases.length} cases`);
    if (c.caseNumber !== '3' || c.title !== 'LANTERN BIKES' || c.industry !== 'Consumer' || c.type !== 'Growth') problems.push(`header/title/subtitle: ${c.caseNumber} ${c.title} ${c.industry}|${c.type}`);
    if (!/fictional maker/.test(c.prompt) || /Note/.test(c.prompt)) problems.push('prompt');
    if (c.clarifyingFacts.map(f => f.q).join('|') !== 'What is the goal?|Market') problems.push(`facts: ${c.clarifyingFacts.map(f => f.q)}`);
    if (!/team you led/.test(c.behavioral) || /INTERVIEW/.test(c.behavioral)) problems.push(`behavioral: ${c.behavioral}`);
    if (c.frameworkHint !== 'Revenue and costs.') problems.push('framework guidance');
    if (c.questions.map(q => q.label).join('|') !== 'Question 1|Brainstorming') problems.push(`stages: ${c.questions.map(q => q.label)}`);
    const q1 = c.questions[0];
    if (q1?.text !== '• What does the exhibit show?' && q1?.text !== 'What does the exhibit show?') problems.push(`Q1 text: ${q1?.text}`);
    if (!/Sales are flat/.test(q1?.answer) || !/flat trend/.test(q1?.answer)) problems.push('Q1 guidance');
    if (q1?.framework[0]?.label !== 'Units' || q1.framework[0].value !== '4,000') problems.push(`rows: ${JSON.stringify(q1?.framework)}`);
    if (c.exhibits[0]?.stage !== 1) problems.push('exhibit not shown with the question after it');
    if (c.conclusion !== 'What should the client do?' || !/two new cities/.test(c.recommendation) || !/Risks:/.test(c.recommendation)) problems.push('conclusion/recommendation');
    if (/Structure 1 2 3/.test(JSON.stringify(c))) problems.push('feedback form parsed');
    add('8. Slide-style layout: headers, stages, guidance and figures', !problems.length, problems.length ? problems.join('; ')
      : 'Running header with letter-spaced, doubled text starts the case; stages keep their names; guidance, "Provide if asked" figures, conclusion and risks land in the right fields; the feedback form is ignored.');
  });

  return results;
}

/* ---------- Node entry: node cases/tests/tests.js ---------- */
if (typeof window === 'undefined' && typeof process !== 'undefined' && process.argv?.[1]?.endsWith('tests.js')) {
  const results = await runTests();
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.details}`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
}
