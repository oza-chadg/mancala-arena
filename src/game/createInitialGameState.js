import {
  BOARD_SIZE,
  PLAYER_ONE,
  PLAYER_ONE_STORE,
  PLAYER_TWO_STORE,
  STARTING_STONES_PER_PIT
} from "./types.js";

/**
 * @param {{ id: string, playerOneId: string, now?: string, expiresAt?: string }} input
 * @returns {import("./types.js").GameState}
 */
export function createInitialGameState({ id, playerOneId, now = new Date().toISOString(), expiresAt = now }) {
  const pits = Array.from({ length: BOARD_SIZE }, () => STARTING_STONES_PER_PIT);
  pits[PLAYER_ONE_STORE] = 0;
  pits[PLAYER_TWO_STORE] = 0;

  return {
    id,
    status: "waiting",
    mode: "multiplayer",
    botDifficulty: null,
    players: {
      one: {
        id: playerOneId,
        connected: true
      },
      two: null
    },
    board: {
      pits
    },
    currentPlayer: PLAYER_ONE,
    winner: null,
    lastMove: null,
    moveHistory: [],
    gameReview: null,
    rematchRequests: {
      one: false,
      two: false
    },
    createdAt: now,
    updatedAt: now,
    expiresAt
  };
}
