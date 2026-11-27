// Action constructors and validation messages. Actions are plain JSON objects.

export const A = {
  placeSettlement: (player, vertex) => ({ type: 'placeSettlement', player, vertex }),
  placeRoad: (player, edge) => ({ type: 'placeRoad', player, edge }),
  roll: player => ({ type: 'roll', player }),
  discard: (player, cards) => ({ type: 'discard', player, cards }),
  moveRobber: (player, hex, victim = null) => ({ type: 'moveRobber', player, hex, victim }),
  buildRoad: (player, edge) => ({ type: 'buildRoad', player, edge }),
  buildSettlement: (player, vertex) => ({ type: 'buildSettlement', player, vertex }),
  buildCity: (player, vertex) => ({ type: 'buildCity', player, vertex }),
  buyCard: player => ({ type: 'buyCard', player }),
  playCard: (player, card, params = {}) => ({ type: 'playCard', player, card, ...params }),
  maritimeTrade: (player, give, get) => ({ type: 'maritimeTrade', player, give, get }),
  proposeTrade: (player, to, give, get) => ({ type: 'proposeTrade', player, to, give, get }),
  respondTrade: (player, accept) => ({ type: 'respondTrade', player, accept: !!accept }),
  finishCharter: player => ({ type: 'finishCharter', player }),
  endTurn: player => ({ type: 'endTurn', player })
};
export const ACTION_TYPES = Object.keys(A);

/** Readable reasons an action was refused. */
export const MSG = {
  over: 'The game is over.',
  unknown: t => `Unknown action "${t}".`,
  notYou: name => `It's ${name}'s move.`,
  phase: (what, phase) => `You can't ${what} right now (phase: ${phase}).`,
  spot: what => `You can't place a ${what} there.`,
  afford: (what, cost) => `Not enough resources for a ${what}. It costs ${cost}.`,
  noPieces: what => `You have no ${what}s left.`,
  badCards: 'Those cards are not in your hand.',
  discardCount: n => `Discard exactly ${n} card${n === 1 ? '' : 's'}.`,
  robberSame: 'The robber has to move to a different hex.',
  victim: 'Choose one of the players beside that hex, or nobody if there is no one to rob.',
  deckEmpty: 'There are no cards left to buy.',
  cardMissing: label => `You don't have a ${label} you can play.`,
  cardNewThisTurn: label => `A ${label} bought this turn can be played from your next turn.`,
  oneCard: 'Only one card can be played per turn.',
  resource: r => `"${r}" isn't a resource.`,
  rate: (n, label) => `This trade needs ${n} ${label}.`,
  tradeShape: 'A trade needs at least one card on each side.',
  tradeTarget: 'Choose another player to trade with.',
  tradeSame: "You can't trade a resource for the same resource.",
  theyCant: name => `${name} doesn't have those cards.`
};

/** Basic shape checks before the rules run. Throws a readable Error. */
export function checkShape(action) {
  if (!action || typeof action !== 'object') throw new Error('An action must be an object.');
  if (!ACTION_TYPES.includes(action.type)) throw new Error(MSG.unknown(action.type));
  if (!Number.isInteger(action.player)) throw new Error('An action needs a player number.');
}

const cardList = c => Object.entries(c || {}).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`).join(', ');
/** One-line description, used by the UI and in error reports. */
export function describe(action, names = []) {
  const who = names[action.player] ?? `Player ${action.player + 1}`;
  switch (action.type) {
    case 'placeSettlement': case 'buildSettlement': return `${who} builds a settlement`;
    case 'placeRoad': case 'buildRoad': return `${who} builds a road`;
    case 'buildCity': return `${who} builds a city`;
    case 'roll': return `${who} rolls`;
    case 'discard': return `${who} discards ${cardList(action.cards)}`;
    case 'moveRobber': return `${who} moves the robber`;
    case 'buyCard': return `${who} buys a card`;
    case 'playCard': return `${who} plays ${action.card}`;
    case 'maritimeTrade': return `${who} trades with the bank`;
    case 'proposeTrade': return `${who} offers a trade`;
    case 'respondTrade': return `${who} ${action.accept ? 'accepts' : 'declines'} the trade`;
    case 'finishCharter': return `${who} finishes the charter`;
    case 'endTurn': return `${who} ends the turn`;
    default: return action.type;
  }
}
