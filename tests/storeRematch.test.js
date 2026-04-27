import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryGameStore } from "../src/store/inMemoryGameStore.js";

function completedGame(store) {
  const created = store.createGame();
  const joined = store.joinGame(created.gameId);
  store.setGameState(created.gameId, {
    ...joined.gameState,
    status: "completed",
    winner: "one",
    board: {
      pits: [0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0, 0, 0, 18]
    }
  });

  return { created, joined };
}

test("one rematch request marks readiness without creating a new game", () => {
  const store = new InMemoryGameStore();
  const { created } = completedGame(store);

  const result = store.requestRematch(created.gameId, created.playerToken);

  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(result.gameState.rematchRequests.one, true);
  assert.equal(result.gameState.rematchRequests.two, false);
});

test("both rematch requests create a fresh two-player game", () => {
  const store = new InMemoryGameStore();
  const { created, joined } = completedGame(store);

  store.requestRematch(created.gameId, created.playerToken);
  const result = store.requestRematch(created.gameId, joined.playerToken);

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.notEqual(result.gameId, created.gameId);
  assert.equal(result.gameState.status, "in_progress");
  assert.equal(typeof result.playerTokens.one, "string");
  assert.equal(typeof result.playerTokens.two, "string");
  assert.ok(result.gameState.players.one);
  assert.ok(result.gameState.players.two);
});

test("invalid token cannot request a rematch", () => {
  const store = new InMemoryGameStore();
  const { created } = completedGame(store);

  const result = store.requestRematch(created.gameId, "not-a-token");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "Invalid player token.");
});

test("bot game starts immediately with bot in player two seat", () => {
  const store = new InMemoryGameStore();
  const created = store.createBotGame({ socketId: "socket-one", difficulty: "hard" });

  assert.equal(created.gameState.mode, "bot");
  assert.equal(created.gameState.botDifficulty, "hard");
  assert.equal(created.gameState.status, "in_progress");
  assert.equal(created.gameState.players.one.socketId, "socket-one");
  assert.equal(created.gameState.players.two.isBot, true);
  assert.equal(store.getPlayerByToken(created.gameId, created.playerToken), "one");
});

test("bot game falls back to normal for unknown difficulty", () => {
  const store = new InMemoryGameStore();
  const created = store.createBotGame({ difficulty: "nightmare" });

  assert.equal(created.gameState.botDifficulty, "normal");
});

test("human cannot join a bot-filled game as a third player", () => {
  const store = new InMemoryGameStore();
  const created = store.createBotGame();

  const result = store.joinGame(created.gameId);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "This game already has two players.");
});

test("bot rematch preserves difficulty", () => {
  const store = new InMemoryGameStore();
  const created = store.createBotGame({ difficulty: "easy", socketId: "socket-one" });
  store.setGameState(created.gameId, {
    ...created.gameState,
    status: "completed",
    winner: "one"
  });

  const result = store.requestRematch(created.gameId, created.playerToken);

  assert.equal(result.ok, true);
  assert.equal(result.gameState.mode, "bot");
  assert.equal(result.gameState.botDifficulty, "easy");
});

test("expired games are removed during cleanup", () => {
  const store = new InMemoryGameStore();
  const created = store.createGame();
  store.games.get(created.gameId).gameState.expiresAt = "2026-01-01T00:00:00.000Z";

  const expiredGameIds = store.cleanupExpiredGames(new Date("2026-01-01T00:00:01.000Z"));

  assert.deepEqual(expiredGameIds, [created.gameId]);
  assert.equal(store.getGame(created.gameId), null);
  assert.equal(store.getExpiredReason(created.gameId), "This game has expired. Create a new game to keep playing.");
});

test("joining an expired game returns an expiry message", () => {
  const store = new InMemoryGameStore();
  const created = store.createGame();
  store.games.get(created.gameId).gameState.expiresAt = "2026-01-01T00:00:00.000Z";

  const result = store.joinGame(created.gameId);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "This game has expired. Create a new game to keep playing.");
});
