# The Frontier Archipelago — Phase A

An original hex-based island trading game for 3 to 5 players, played hot-seat on one device.
Phase A is the rules engine, a hot-seat UI and the tests. There is no networking yet; the engine is built so Phase B can sync it (see below).

## Run it

ES modules and `fetch` need http, so serve the repository (or this folder) and open `game-islands/index.html`:

```
python3 -m http.server 8000
# then open http://localhost:8000/game-islands/
```

- `index.html?seed=abc` fills in the seed on the start screen.
- `index.html?seed=abc&names=Ana,Ben,Cy` starts a game straight away.
- `index.html?test` runs all tests in the browser, including the layout test.
- `node game-islands/js/tests.js` runs tests 1–8 in Node (test 9 needs a browser).

A game in progress is saved in the browser as seed + names + action list, and the start screen offers to resume it.

## How to play

| | |
|---|---|
| Resources | Timber (forest), Clay (pits), Fleece (pasture), Grain (fields), Iron (hills). The Barrens produce nothing. |
| Setup | Snake order: each player places a settlement and a road, then again in reverse. The second settlement pays one of each resource around it. |
| Turn | Roll 2d6. Every hex with that number pays: 1 per settlement, 2 per city. The robber's hex pays nothing. |
| A 7 | Anyone holding 8 or more cards discards half (rounded down). The roller moves the robber and takes a random card from a player beside it. |
| Build | Road: Timber + Clay. Settlement: Timber + Clay + Fleece + Grain. City (upgrade): 2 Grain + 3 Iron. Card: Fleece + Grain + Iron. Settlements need two edges of space and must touch your road. |
| Trade | Offer any trade to one player, or trade with the bank at 4:1, 3:1 at an "any" harbor, 2:1 at a resource harbor. |
| Cards | Privateer ×14 (move the robber and steal; can be played before rolling), Charter ×2 (2 free roads), Windfall ×2 (any 2 resources), Embargo ×2 (name a resource; everyone hands theirs to you), Monument ×5 (1 hidden victory point). One card per turn, never on the turn it was bought. |
| Points | Settlement 1, city 2, Monument 1. Awards worth 2 each: Longest Road (5+ roads in a chain), Harbor Mastery (buildings on 3+ harbors), Largest Fleet (3+ Privateers played). An award passes only to a player who strictly beats the holder. |
| Winning | 10 victory points, checked only on your own turn. |

All numbers above live in `data/config.json` and `data/costs.json`.

## Files

```
index.html          hot-seat UI and test panel (?test)
css/islands.css     all styles; palette as CSS variables
js/rng.js           seeded RNG (mulberry32); the position is stored in the state
js/board.js         hex grid, board generation, harbors
js/rules.js         pure rule helpers: placement, production, trade rates, longest road, awards, points
js/actions.js       action constructors and readable error messages
js/state.js         createGame, legalActions, applyAction, replay
js/ui.js            the hot-seat interface (DOM only, no rules)
js/tests.js         tests 1–8 (Node and browser) and 9 (browser layout)
data/config.json    players, terrains, tokens, harbors, pieces, points, awards, cards, colors
data/costs.json     build costs
images/             textures, resource icons and piece silhouettes
```

## Engine API

```js
import { createGame, legalActions, applyAction, replay } from './js/state.js';
const config = { ...configJson, costs: costsJson };
let state = createGame(config, 'my-seed', ['Ana', 'Ben', 'Cy']);
legalActions(state);                 // what the player who must act can do now
state = applyAction(state, action);  // returns a new state, or throws an Error with a readable message
```

- **Pure.** No DOM, no clock, no randomness except the seeded RNG. The RNG position is part of the state, so dice and steals are reproducible.
- **Never mutates.** `applyAction` deep-copies the input; tests deep-freeze inputs to prove it.
- **JSON-safe.** State and actions are plain JSON. `state.history` holds every action; `replay(config, seed, names, history)` rebuilds the exact same state.
- **Who acts.** `actorOf(state)` is the player who must act now: the turn owner, a player who must discard, or the target of a trade offer.
- **Templates.** Some legal actions are templates for the UI to fill in: `discard` (`count`), Windfall (`choose: 2`) and `proposeTrade`.

### Phase B sync notes

Because the engine is deterministic and actions are small JSON objects, the network layer only needs to agree on the seed, the player names and the ordered action list. Each client runs `applyAction` locally; a server (or the host) validates the same way and rejects anything that throws. Hidden information (hands, the card deck order) is in the full state today, so Phase B should keep the authoritative state on the server and send each player a filtered view.

## Assets

All art is original to this project. Missing images are replaced by plain shapes and fills, with a `console.warn`, and the game keeps running. Piece images are white silhouettes tinted to the owner's color with an SVG mask; settlements and cities also carry the owner's letter, so color is never the only signal.

## Accessibility

Every hex, corner and edge is a focusable button with a spoken label. Places you can build are tab stops; arrow keys move between neighbours; Enter or Space acts; Esc cancels a build. Focus rings are amber. Animations switch off under `prefers-reduced-motion`.
