import test from "node:test";
import assert from "node:assert/strict";
import { applyMove } from "../src/game/applyMove.js";
import { checkGameOver } from "../src/game/checkGameOver.js";
import { createInitialGameState } from "../src/game/createInitialGameState.js";
import { validateMove } from "../src/game/validateMove.js";

function inProgress(overrides = {}) {
  return {
    ...createInitialGameState({
      id: "test-game",
      playerOneId: "player-one",
      now: "2026-01-01T00:00:00.000Z"
    }),
    status: "in_progress",
    players: {
      one: { id: "player-one", connected: true },
      two: { id: "player-two", connected: true }
    },
    ...overrides
  };
}

test("initial board has 4 stones in each pit and 0 in stores", () => {
  const game = createInitialGameState({ id: "game", playerOneId: "one" });

  assert.deepEqual(game.board.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(game.status, "waiting");
  assert.equal(game.currentPlayer, "one");
  assert.deepEqual(game.moveHistory, []);
  assert.deepEqual(game.rematchRequests, { one: false, two: false });
});

test("player one can make a normal move", () => {
  const game = inProgress();
  const updated = applyMove(game, "one", 0, "2026-01-01T00:00:01.000Z");

  assert.deepEqual(updated.board.pits, [0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(updated.currentPlayer, "two");
  assert.equal(updated.lastMove.wasExtraTurn, false);
});

test("valid moves are recorded in move history with resulting store scores", () => {
  const game = inProgress();
  const updated = applyMove(game, "one", 2, "2026-01-01T00:00:01.000Z");

  assert.deepEqual(updated.moveHistory, [
    {
      player: "one",
      pitIndex: 2,
      wasCapture: false,
      wasExtraTurn: true,
      stores: {
        one: 1,
        two: 0
      },
      createdAt: "2026-01-01T00:00:01.000Z"
    }
  ]);
});

test("player two can make a normal move", () => {
  const game = inProgress({ currentPlayer: "two" });
  const updated = applyMove(game, "two", 7, "2026-01-01T00:00:01.000Z");

  assert.deepEqual(updated.board.pits, [4, 4, 4, 4, 4, 4, 0, 0, 5, 5, 5, 5, 4, 0]);
  assert.equal(updated.currentPlayer, "one");
});

test("opponent store is skipped", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 0, 0, 0, 10, 0, 4, 4, 4, 4, 4, 4, 0]
    }
  });

  const updated = applyMove(game, "one", 5, "2026-01-01T00:00:01.000Z");

  assert.equal(updated.board.pits[13], 0);
  assert.equal(updated.board.pits[0], 1);
});

test("landing in own store grants an extra turn", () => {
  const game = inProgress();
  const updated = applyMove(game, "one", 2, "2026-01-01T00:00:01.000Z");

  assert.equal(updated.board.pits[6], 1);
  assert.equal(updated.currentPlayer, "one");
  assert.equal(updated.lastMove.wasExtraTurn, true);
});

test("landing in an empty own pit captures opposite stones", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 1, 0, 0, 0, 0, 4, 0, 7, 0, 0, 0, 0]
    }
  });

  const updated = applyMove(game, "one", 2, "2026-01-01T00:00:01.000Z");

  assert.equal(updated.board.pits[3], 0);
  assert.equal(updated.board.pits[9], 0);
  assert.equal(updated.board.pits[6], 8);
  assert.equal(updated.lastMove.wasCapture, true);
});

test("selecting an empty pit is invalid", () => {
  const game = inProgress({
    board: {
      pits: [0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]
    }
  });

  assert.equal(validateMove(game, "one", 0).valid, false);
  assert.throws(() => applyMove(game, "one", 0), /non-empty/);
});

test("selecting opponent pit is invalid", () => {
  const game = inProgress();

  assert.equal(validateMove(game, "one", 7).valid, false);
  assert.throws(() => applyMove(game, "one", 7), /own pits/);
});

test("moving out of turn is invalid", () => {
  const game = inProgress({ currentPlayer: "two" });

  assert.equal(validateMove(game, "one", 0).valid, false);
  assert.throws(() => applyMove(game, "one", 0), /not your turn/);
});

test("game ends when one side is empty", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 0, 0, 0, 1, 10, 4, 4, 4, 4, 4, 4, 9]
    }
  });

  const updated = applyMove(game, "one", 5, "2026-01-01T00:00:01.000Z");

  assert.equal(updated.status, "completed");
});

test("completed games include a compact game review", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 0, 0, 0, 1, 10, 4, 4, 4, 4, 4, 4, 9]
    }
  });

  const updated = applyMove(game, "one", 5, "2026-01-01T00:00:01.000Z");

  assert.deepEqual(updated.gameReview.captures, { one: 0, two: 0 });
  assert.deepEqual(updated.gameReview.extraTurns, { one: 1, two: 0 });
  assert.deepEqual(updated.gameReview.biggestStoreGain, {
    player: "one",
    pitIndex: 5,
    gain: 11
  });
});

test("remaining stones are swept into the other store", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 0, 0, 0, 0, 10, 1, 2, 3, 4, 5, 6, 9]
    }
  });

  const updated = checkGameOver(game, "2026-01-01T00:00:01.000Z");

  assert.deepEqual(updated.board.pits, [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 30]);
});

test("winner is calculated correctly", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 0, 1, 22]
    }
  });

  const updated = checkGameOver(game, "2026-01-01T00:00:01.000Z");

  assert.equal(updated.winner, "one");
});

test("draw is handled correctly", () => {
  const game = inProgress({
    board: {
      pits: [0, 0, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 0, 24]
    }
  });

  const updated = checkGameOver(game, "2026-01-01T00:00:01.000Z");

  assert.equal(updated.winner, "draw");
});
