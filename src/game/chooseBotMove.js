import { applyMove } from "./applyMove.js";
import { PLAYER_ONE_STORE, PLAYER_TWO_STORE, getOpponent, getPlayerPits, getStoreIndex } from "./types.js";
import { validateMove } from "./validateMove.js";

export const BOT_DIFFICULTIES = ["easy", "normal", "hard"];

export function normalizeBotDifficulty(difficulty) {
  return BOT_DIFFICULTIES.includes(difficulty) ? difficulty : "normal";
}

function getLegalPits(gameState, player) {
  return getPlayerPits(player).filter((pitIndex) => validateMove(gameState, player, pitIndex).valid);
}

function evaluateState(gameState, player) {
  const opponent = getOpponent(player);
  const storeLead =
    gameState.board.pits[getStoreIndex(player)] - gameState.board.pits[getStoreIndex(opponent)];
  const sideLead =
    getPlayerPits(player).reduce((total, pitIndex) => total + gameState.board.pits[pitIndex], 0) -
    getPlayerPits(opponent).reduce((total, pitIndex) => total + gameState.board.pits[pitIndex], 0);
  let score = storeLead * 20 + sideLead;

  if (gameState.status === "completed") {
    if (gameState.winner === player) {
      score += 1000;
    } else if (gameState.winner === opponent) {
      score -= 1000;
    }
  }

  return score;
}

function scoreNormalCandidate(gameState, player, pitIndex) {
  const beforeStore = gameState.board.pits[getStoreIndex(player)];
  const nextState = applyMove(gameState, player, pitIndex, gameState.updatedAt);
  const storeGain = nextState.board.pits[getStoreIndex(player)] - beforeStore;
  let score = storeGain * 10;

  if (nextState.lastMove.wasExtraTurn) {
    score += 100;
  }

  if (nextState.lastMove.wasCapture) {
    score += 60;
  }

  if (nextState.status === "completed" && nextState.winner === player) {
    score += 200;
  }

  return score;
}

function scoreHardCandidate(gameState, player, pitIndex) {
  const nextState = applyMove(gameState, player, pitIndex, gameState.updatedAt);
  let score = evaluateState(nextState, player) + scoreNormalCandidate(gameState, player, pitIndex);

  if (nextState.status === "completed") {
    return score;
  }

  if (nextState.currentPlayer === player) {
    const followUpScores = getLegalPits(nextState, player).map((followUpPit) =>
      scoreHardCandidate(nextState, player, followUpPit)
    );
    return score + (followUpScores.length ? Math.max(...followUpScores) * 0.45 : 0);
  }

  const opponent = getOpponent(player);
  const opponentScores = getLegalPits(nextState, opponent).map((opponentPit) => {
    const afterOpponent = applyMove(nextState, opponent, opponentPit, nextState.updatedAt);
    const opponentGain =
      afterOpponent.board.pits[opponent === "one" ? PLAYER_ONE_STORE : PLAYER_TWO_STORE] -
      nextState.board.pits[opponent === "one" ? PLAYER_ONE_STORE : PLAYER_TWO_STORE];
    return evaluateState(afterOpponent, player) - opponentGain * 12;
  });

  if (opponentScores.length > 0) {
    score += Math.min(...opponentScores);
  }

  return score;
}

function chooseBestMove(gameState, player, scoreMove) {
  const legalPits = getLegalPits(gameState, player);
  if (legalPits.length === 0) {
    return null;
  }

  return legalPits
    .map((pitIndex) => ({
      pitIndex,
      score: scoreMove(gameState, player, pitIndex)
    }))
    .sort((a, b) => b.score - a.score || a.pitIndex - b.pitIndex)[0].pitIndex;
}

/**
 * Pick a legal bot move for the requested difficulty.
 *
 * @param {import("./types.js").GameState} gameState
 * @param {import("./types.js").PlayerKey} player
 * @param {"easy" | "normal" | "hard"} [difficulty]
 * @param {() => number} [random]
 * @returns {number | null}
 */
export function chooseBotMove(gameState, player = "two", difficulty = "normal", random = Math.random) {
  const legalPits = getLegalPits(gameState, player);
  if (legalPits.length === 0) {
    return null;
  }

  const normalizedDifficulty = normalizeBotDifficulty(difficulty);

  if (normalizedDifficulty === "easy") {
    return legalPits[Math.floor(random() * legalPits.length)];
  }

  if (normalizedDifficulty === "hard") {
    return chooseBestMove(gameState, player, scoreHardCandidate);
  }

  return chooseBestMove(gameState, player, scoreNormalCandidate);
}
