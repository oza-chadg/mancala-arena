/**
 * @typedef {"one" | "two"} PlayerKey
 * @typedef {"waiting" | "in_progress" | "completed"} GameStatus
 * @typedef {"one" | "two" | "draw" | null} Winner
 *
 * @typedef {object} Player
 * @property {string} id Public player id. This is not the reconnect token.
 * @property {string | undefined} [socketId]
 * @property {boolean} connected
 * @property {boolean | undefined} [isBot]
 *
 * @typedef {object} GameState
 * @property {string} id
 * @property {GameStatus} status
 * @property {"multiplayer" | "bot"} mode
 * @property {"easy" | "normal" | "hard" | null} botDifficulty
 * @property {{ one: Player, two: Player | null }} players
 * @property {{ pits: number[] }} board
 * @property {PlayerKey} currentPlayer
 * @property {Winner} winner
 * @property {{ player: PlayerKey, pitIndex: number, wasCapture: boolean, wasExtraTurn: boolean } | null} lastMove
 * @property {Array<{ player: PlayerKey, pitIndex: number, wasCapture: boolean, wasExtraTurn: boolean, stores: { one: number, two: number }, createdAt: string }>} moveHistory
 * @property {{ captures: { one: number, two: number }, extraTurns: { one: number, two: number }, biggestStoreGain: { player: PlayerKey, pitIndex: number, gain: number } | null } | null} gameReview
 * @property {{ one: boolean, two: boolean }} rematchRequests
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} expiresAt
 */

export const PLAYER_ONE = "one";
export const PLAYER_TWO = "two";

export const PITS_PER_PLAYER = 6;
export const STARTING_STONES_PER_PIT = 4;
export const BOARD_SIZE = 14;

export const PLAYER_ONE_PITS = [0, 1, 2, 3, 4, 5];
export const PLAYER_ONE_STORE = 6;
export const PLAYER_TWO_PITS = [7, 8, 9, 10, 11, 12];
export const PLAYER_TWO_STORE = 13;

export function getPlayerPits(player) {
  return player === PLAYER_ONE ? PLAYER_ONE_PITS : PLAYER_TWO_PITS;
}

export function getStoreIndex(player) {
  return player === PLAYER_ONE ? PLAYER_ONE_STORE : PLAYER_TWO_STORE;
}

export function getOpponentStoreIndex(player) {
  return player === PLAYER_ONE ? PLAYER_TWO_STORE : PLAYER_ONE_STORE;
}

export function getOpponent(player) {
  return player === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
}

export function getOppositePitIndex(pitIndex) {
  return 12 - pitIndex;
}

export function isOwnPit(player, pitIndex) {
  return getPlayerPits(player).includes(pitIndex);
}

export function hasEmptySide(pits, player) {
  return getPlayerPits(player).every((pitIndex) => pits[pitIndex] === 0);
}
