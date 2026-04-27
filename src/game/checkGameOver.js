import {
  PLAYER_ONE,
  PLAYER_ONE_PITS,
  PLAYER_ONE_STORE,
  PLAYER_TWO,
  PLAYER_TWO_PITS,
  PLAYER_TWO_STORE,
  hasEmptySide
} from "./types.js";

function sweepRemainingStones(pits, pitIndexes, storeIndex) {
  const remaining = pitIndexes.reduce((total, pitIndex) => total + pits[pitIndex], 0);
  for (const pitIndex of pitIndexes) {
    pits[pitIndex] = 0;
  }
  pits[storeIndex] += remaining;
}

/**
 * @param {import("./types.js").GameState} gameState
 * @param {string} [now]
 * @returns {import("./types.js").GameState}
 */
export function checkGameOver(gameState, now = new Date().toISOString()) {
  const pits = [...gameState.board.pits];
  const isPlayerOneEmpty = hasEmptySide(pits, PLAYER_ONE);
  const isPlayerTwoEmpty = hasEmptySide(pits, PLAYER_TWO);

  if (!isPlayerOneEmpty && !isPlayerTwoEmpty) {
    return gameState;
  }

  if (!isPlayerOneEmpty) {
    sweepRemainingStones(pits, PLAYER_ONE_PITS, PLAYER_ONE_STORE);
  }

  if (!isPlayerTwoEmpty) {
    sweepRemainingStones(pits, PLAYER_TWO_PITS, PLAYER_TWO_STORE);
  }

  let winner = "draw";
  if (pits[PLAYER_ONE_STORE] > pits[PLAYER_TWO_STORE]) {
    winner = PLAYER_ONE;
  } else if (pits[PLAYER_TWO_STORE] > pits[PLAYER_ONE_STORE]) {
    winner = PLAYER_TWO;
  }

  return {
    ...gameState,
    status: "completed",
    board: {
      pits
    },
    winner,
    updatedAt: now
  };
}
