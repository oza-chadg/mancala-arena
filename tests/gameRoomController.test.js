import test from "node:test";
import assert from "node:assert/strict";
import { GameRoomController, EXPIRED_GAME_REASON } from "../src/worker/gameRoomController.js";

function sequence(prefix) {
  let index = 0;
  return () => `${prefix}_${index++}`;
}

function tokens() {
  let index = 0;
  return () => `token_${index++}`;
}

function fixedNow(value = "2026-04-28T00:00:00.000Z") {
  return () => new Date(value);
}

function createController() {
  return new GameRoomController({
    now: fixedNow(),
    random: () => 0,
    createId: sequence("id"),
    createToken: tokens()
  });
}

function completeGame(controller) {
  controller.record.gameState = {
    ...controller.record.gameState,
    status: "completed",
    winner: "one",
    board: {
      pits: [0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0, 0, 0, 18]
    }
  };
}

test("create game initializes and keeps tokens outside public state", () => {
  const controller = createController();
  const result = controller.createGame({ gameId: "game_a", origin: "https://example.com" });

  assert.equal(result.gameId, "game_a");
  assert.equal(result.playerToken, "token_0");
  assert.equal(result.joinUrl, "https://example.com/?gameId=game_a");
  assert.equal(controller.record.tokens.one, "token_0");
  assert.equal(result.gameState.players.one.connected, true);
  assert.equal(Object.hasOwn(result.gameState, "tokens"), false);
});

test("join with invite seats player two", () => {
  const controller = createController();
  controller.createGame({ gameId: "game_a", origin: "https://example.com" });

  const result = controller.joinOrReconnect(null);

  assert.equal(result.ok, true);
  assert.equal(result.player, "two");
  assert.equal(result.playerToken, "token_1");
  assert.equal(result.gameState.status, "in_progress");
  assert.equal(result.gameState.players.two.connected, true);
});

test("reconnect with token restores the same seat", () => {
  const controller = createController();
  const created = controller.createGame({ gameId: "game_a", origin: "https://example.com" });
  controller.markConnected("one", false);

  const result = controller.joinOrReconnect(created.playerToken);

  assert.equal(result.ok, true);
  assert.equal(result.reconnected, true);
  assert.equal(result.player, "one");
  assert.equal(result.playerToken, created.playerToken);
  assert.equal(result.gameState.players.one.connected, true);
});

test("invalid token cannot request game state", () => {
  const controller = createController();
  controller.createGame({ gameId: "game_a", origin: "https://example.com" });

  const result = controller.requestGameState("wrong-token");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "Invalid player token.");
});

test("invalid token cannot claim an invite seat", () => {
  const controller = createController();
  controller.createGame({ gameId: "game_a", origin: "https://example.com" });

  const result = controller.joinOrReconnect("wrong-token");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "Invalid player token.");
});

test("valid move records public state without leaking tokens", () => {
  const controller = createController();
  const created = controller.createGame({ gameId: "game_a", origin: "https://example.com" });
  controller.joinOrReconnect(null);

  const result = controller.makeMove(created.playerToken, 0);

  assert.equal(result.ok, true);
  assert.equal(result.gameState.moveHistory.length, 1);
  assert.equal(result.gameState.lastMove.player, "one");
  assert.equal(Object.hasOwn(result.gameState, "tokens"), false);
});

test("bot alarm path applies a bot move", () => {
  const controller = createController();
  const created = controller.createBotGame({ gameId: "game_a", origin: "https://example.com", difficulty: "easy" });
  const humanMove = controller.makeMove(created.playerToken, 0);

  assert.equal(humanMove.ok, true);
  assert.equal(controller.record.botMoveAt, "2026-04-28T00:00:00.700Z");

  const botMove = controller.applyBotMove();

  assert.equal(botMove.ok, true);
  assert.equal(botMove.gameState.moveHistory.at(-1).player, "two");
});

test("human rematch requires both players", () => {
  const controller = createController();
  const created = controller.createGame({ gameId: "game_a", origin: "https://example.com" });
  const joined = controller.joinOrReconnect(null);
  completeGame(controller);

  const first = controller.requestRematch(created.playerToken);
  const second = controller.requestRematch(joined.playerToken);

  assert.equal(first.ok, true);
  assert.equal(first.pending, true);
  assert.equal(second.ok, true);
  assert.equal(second.createRematch.mode, "multiplayer");
});

test("bot rematch can restart immediately", () => {
  const controller = createController();
  const created = controller.createBotGame({ gameId: "game_a", origin: "https://example.com", difficulty: "hard" });
  completeGame(controller);

  const result = controller.requestRematch(created.playerToken);

  assert.equal(result.ok, true);
  assert.equal(result.pending, false);
  assert.equal(result.createRematch.mode, "bot");
  assert.equal(result.createRematch.difficulty, "hard");
});

test("expired waiting invite returns stale-link message", () => {
  const controller = createController();
  controller.createGame({ gameId: "game_a", origin: "https://example.com" });
  controller.record.gameState.expiresAt = "2026-04-27T00:00:00.000Z";

  const result = controller.joinOrReconnect(null);

  assert.equal(result.ok, false);
  assert.equal(result.expired, true);
  assert.equal(result.reason, EXPIRED_GAME_REASON);
});
