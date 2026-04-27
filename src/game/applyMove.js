import { checkGameOver } from "./checkGameOver.js";
import {
  PLAYER_ONE_STORE,
  PLAYER_TWO_STORE,
  getOpponent,
  getOpponentStoreIndex,
  getOppositePitIndex,
  getStoreIndex,
  isOwnPit
} from "./types.js";
import { validateMove } from "./validateMove.js";

function appendMoveHistory(gameState, move, now) {
  return {
    ...gameState,
    moveHistory: [
      ...(gameState.moveHistory ?? []),
      {
        ...move,
        stores: {
          one: gameState.board.pits[PLAYER_ONE_STORE],
          two: gameState.board.pits[PLAYER_TWO_STORE]
        },
        createdAt: now
      }
    ]
  };
}

function buildGameReview(gameState) {
  const review = {
    captures: {
      one: 0,
      two: 0
    },
    extraTurns: {
      one: 0,
      two: 0
    },
    biggestStoreGain: null
  };
  let previousStores = {
    one: 0,
    two: 0
  };

  for (const entry of gameState.moveHistory ?? []) {
    if (entry.wasCapture) {
      review.captures[entry.player] += 1;
    }

    if (entry.wasExtraTurn) {
      review.extraTurns[entry.player] += 1;
    }

    const gain = entry.stores[entry.player] - previousStores[entry.player];
    if (!review.biggestStoreGain || gain > review.biggestStoreGain.gain) {
      review.biggestStoreGain = {
        player: entry.player,
        pitIndex: entry.pitIndex,
        gain
      };
    }

    previousStores = entry.stores;
  }

  return review;
}

/**
 * @param {import("./types.js").GameState} gameState
 * @param {import("./types.js").PlayerKey} player
 * @param {number} pitIndex
 * @param {string} [now]
 * @returns {import("./types.js").GameState}
 */
export function applyMove(gameState, player, pitIndex, now = new Date().toISOString()) {
  const validation = validateMove(gameState, player, pitIndex);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const pits = [...gameState.board.pits];
  let stones = pits[pitIndex];
  let currentIndex = pitIndex;
  pits[pitIndex] = 0;

  while (stones > 0) {
    currentIndex = (currentIndex + 1) % pits.length;

    // Kalah skips the opponent's store while sowing.
    if (currentIndex === getOpponentStoreIndex(player)) {
      continue;
    }

    pits[currentIndex] += 1;
    stones -= 1;
  }

  const ownStoreIndex = getStoreIndex(player);
  const wasExtraTurn = currentIndex === ownStoreIndex;
  let wasCapture = false;

  if (!wasExtraTurn && isOwnPit(player, currentIndex) && pits[currentIndex] === 1) {
    const oppositePitIndex = getOppositePitIndex(currentIndex);
    const capturedStones = pits[oppositePitIndex];

    // Capture only happens when the last stone lands in an empty own pit
    // and the directly opposite pit has stones to collect.
    if (capturedStones > 0) {
      pits[ownStoreIndex] += capturedStones + 1;
      pits[currentIndex] = 0;
      pits[oppositePitIndex] = 0;
      wasCapture = true;
    }
  }

  const lastMove = {
    player,
    pitIndex,
    wasCapture,
    wasExtraTurn
  };

  const movedState = {
    ...gameState,
    board: {
      pits
    },
    currentPlayer: wasExtraTurn ? player : getOpponent(player),
    lastMove,
    rematchRequests: {
      one: false,
      two: false
    },
    updatedAt: now
  };

  const completedState = checkGameOver(movedState, now);
  const historyState = appendMoveHistory(completedState, lastMove, now);

  if (historyState.status !== "completed") {
    return historyState;
  }

  return {
    ...historyState,
    gameReview: buildGameReview(historyState)
  };
}
