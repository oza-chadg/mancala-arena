import test from "node:test";
import assert from "node:assert/strict";
import { chooseBotMove } from "../src/game/chooseBotMove.js";
import { createInitialGameState } from "../src/game/createInitialGameState.js";

function botTurn(overrides = {}) {
  return {
    ...createInitialGameState({
      id: "bot-game",
      playerOneId: "player-one",
      now: "2026-01-01T00:00:00.000Z"
    }),
    status: "in_progress",
    mode: "bot",
    players: {
      one: { id: "player-one", connected: true },
      two: { id: "practice_bot", connected: true, isBot: true }
    },
    currentPlayer: "two",
    ...overrides
  };
}

test("easy bot picks a random legal move", () => {
  const game = botTurn();

  assert.equal(chooseBotMove(game, "two", "easy", () => 0), 7);
  assert.equal(chooseBotMove(game, "two", "easy", () => 0.99), 12);
});

test("normal bot prefers an extra turn when available", () => {
  const game = botTurn({
    board: {
      pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 1, 0]
    }
  });

  assert.equal(chooseBotMove(game, "two", "normal"), 9);
});

test("hard bot returns a legal move using lookahead", () => {
  const game = botTurn();
  const move = chooseBotMove(game, "two", "hard");

  assert.ok([7, 8, 9, 10, 11, 12].includes(move));
});

test("bot returns null when it has no legal move", () => {
  const game = botTurn({
    board: {
      pits: [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  });

  assert.equal(chooseBotMove(game, "two"), null);
});
