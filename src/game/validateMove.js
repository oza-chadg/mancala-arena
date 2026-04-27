import { isOwnPit } from "./types.js";

/**
 * @param {import("./types.js").GameState} gameState
 * @param {import("./types.js").PlayerKey} player
 * @param {number} pitIndex
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function validateMove(gameState, player, pitIndex) {
  if (!gameState) {
    return { valid: false, reason: "Game not found." };
  }

  if (gameState.status === "waiting") {
    return { valid: false, reason: "Waiting for an opponent." };
  }

  if (gameState.status === "completed") {
    return { valid: false, reason: "This game is already complete." };
  }

  if (gameState.currentPlayer !== player) {
    return { valid: false, reason: "It is not your turn." };
  }

  if (!Number.isInteger(pitIndex)) {
    return { valid: false, reason: "Choose a valid pit." };
  }

  if (!isOwnPit(player, pitIndex)) {
    return { valid: false, reason: "Choose one of your own pits." };
  }

  if (gameState.board.pits[pitIndex] === 0) {
    return { valid: false, reason: "Choose a non-empty pit." };
  }

  return { valid: true };
}
