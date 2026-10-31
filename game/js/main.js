// Entry point. Without ?test: the game (start screen -> encounter).
// With ?test: the engine test panel. Engine modules contain no DOM code.
import { createRng } from './rng.js';
import * as dice from './dice.js';
import * as rules from './rules.js';
import { createCharacter, createMonster } from './entity.js';
import { createEncounter, runEncounter, POLICIES } from './combat.js';
import { runBatch, runAcceptanceTests } from './tests.js';
import { mountGame } from './ui.js';
import { generateFloor } from './floor.js';
import { createRun } from './run.js';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam ?? String(Math.floor(Math.random() * 1e9));
const app = document.getElementById('app');

boot().catch(err => {
  app.replaceChildren(el('p', 'error', `Could not start: ${err.message}`));
  console.error(err);
});

async function boot() {
  const data = await loadData();

  // Console access, e.g.:
  //   RPG.fight('scout', 'goblin', 'abc').log
  //   const e = RPG.encounter('guard', 'goblin', 7); e.act('hard'); e.act('heal'); e.log
  //   RPG.floor('abc')            -> the generated floor 1 for seed "abc"
  //   const r = RPG.run('scout'); r.moves(); r.moveTo('n1'); r.log
  window.RPG = {
    data, seed, dice, rules, createRng, createCharacter, createMonster, createEncounter, runEncounter,
    runBatch: opts => runBatch(data, { seed, ...opts }),
    runTests: () => runAcceptanceTests(data, { seed }),
    floor: (s = seed, n = 1) => generateFloor(s, n, data.floors),
    run: (c = 'scout', s = seed) => createRun(data, { characterId: c, runSeed: s }),
    encounter: (c, m, s = seed) => createEncounter(
      createCharacter(data.characters[c], data.items),
      createMonster(data.monsters[m]),
      s
    ),
    fight: (c, m, s = seed, policy = 'light') => runEncounter({
      player: createCharacter(data.characters[c], data.items),
      monster: createMonster(data.monsters[m]),
      seed: s, policy
    })
  };

  if (params.has('test')) {
    document.body.classList.add('is-test');
    app.classList.add('panel');
    renderPanel(data);
  } else {
    mountGame(app, data, { seed: seedParam });
  }
}

async function loadData() {
  const load = async name => {
    const res = await fetch(new URL(`../data/${name}.json`, import.meta.url));
    if (!res.ok) throw new Error(`data/${name}.json returned HTTP ${res.status}`);
    return res.json();
  };
  const [characters, items, monsters, floors] = await Promise.all(['characters', 'items', 'monsters', 'floors'].map(load));
  return { characters, items, monsters, floors };
}

/* ======================= Test panel (?test) ======================= */
function renderPanel(data) {
  const charSel = select('Character', Object.values(data.characters).map(c => [c.id, c.name]));
  const monSel = select('Monster', Object.values(data.monsters).map(m => [m.id, m.name]));
  const polSel = select('Player policy', Object.keys(POLICIES).map(k => [k, k]));

  const runBtn = el('button', 'btn', 'Run 1000 fights');
  const testBtn = el('button', 'btn btn-quiet', 'Run acceptance tests');
  const stats = el('div', 'stats');
  const tests = el('div', 'tests');
  const logOut = el('pre', 'log');

  const seedLine = el('p', 'muted');
  seedLine.append('Seed: ', el('code', '', seed), `. Reproduce with ?test&seed=${encodeURIComponent(seed)}`);

  app.append(
    el('h1', 'display', 'Combat engine test panel'), seedLine,
    el('div', 'controls', [charSel.wrap, monSel.wrap, polSel.wrap, runBtn, testBtn]),
    el('h2', 'panel-h2', 'Batch results'), stats,
    el('h2', 'panel-h2', 'Acceptance tests'), tests,
    el('h2', 'panel-h2', 'Sample fight (fight #0)'), logOut
  );

  runBtn.addEventListener('click', () => {
    runBtn.disabled = true;
    setTimeout(() => {
      const r = runBatch(data, {
        characterId: charSel.input.value, monsterId: monSel.input.value,
        policy: polSel.input.value, n: 1000, seed
      });
      stats.replaceChildren(
        stat('Win rate', `${(r.winRate * 100).toFixed(1)}%`),
        stat('Average rounds', r.avgRounds.toFixed(2)),
        stat('Average HP left', `${r.avgHp.toFixed(2)} / ${r.maxHp}`),
        stat('Average HP on wins', `${r.avgHpOnWins.toFixed(2)} / ${r.maxHp}`),
        stat('Outcomes', `${r.counts.win} win, ${r.counts.defeat} defeat, ${r.counts.fled} fled, ${r.counts.draw} draw`)
      );
      logOut.textContent = r.sample.log.join('\n');
      runBtn.disabled = false;
    }, 10);
  });

  testBtn.addEventListener('click', () => renderTests(tests, runAcceptanceTests(data, { seed })));
  renderTests(tests, runAcceptanceTests(data, { seed }));
}

function renderTests(container, results) {
  const rows = results.map(r => testRow(r.pass, r.name, r.details));
  rows.push(testRow(true, '9. Test panel with "Run 1000 fights"',
    'This panel. Press the button to print win rate, average rounds, average HP left, and the full log of fight #0.'));
  container.replaceChildren(...rows);
}

function el(tag, className, children) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (children != null) (Array.isArray(children) ? children : [children]).forEach(c => n.append(c));
  return n;
}
function select(label, options) {
  const input = document.createElement('select');
  options.forEach(([value, text]) => input.append(new Option(text, value)));
  return { wrap: el('label', 'field', [el('span', '', label), input]), input };
}
function stat(label, value) {
  return el('div', 'stat', [el('span', 'stat-label', label), el('span', 'stat-value', value)]);
}
function testRow(pass, name, details) {
  return el('div', `test ${pass ? 'pass' : 'fail'}`, [
    el('span', 'badge', pass ? 'PASS' : 'FAIL'), el('strong', '', name), el('p', '', details)
  ]);
}
