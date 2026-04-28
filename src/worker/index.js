import { DurableObject } from "cloudflare:workers";
import { EXPIRED_GAME_REASON, GameRoomController } from "./gameRoomController.js";

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers ?? {})
    }
  });
}

function createGameId() {
  return globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function getPublicOrigin(request, env) {
  return (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

function getRoomStub(env, gameId) {
  const durableObjectId = env.GAME_ROOMS.idFromName(gameId);
  return env.GAME_ROOMS.get(durableObjectId);
}

async function createGame(request, env, mode) {
  const gameId = createGameId();
  const room = getRoomStub(env, gameId);
  const body = mode === "bot" ? await request.json().catch(() => ({})) : {};
  const response = await room.fetch("https://mancala-room/create", {
    method: "POST",
    body: JSON.stringify({
      gameId,
      origin: getPublicOrigin(request, env),
      mode,
      difficulty: body.difficulty
    })
  });

  return response;
}

function sendSocket(ws, type, payload = {}) {
  ws.send(JSON.stringify({ type, ...payload }));
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.controller = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/create") {
      return this.handleCreate(request);
    }

    if (request.method === "POST" && url.pathname === "/create-rematch") {
      return this.handleCreateRematch(request);
    }

    if (request.method === "GET" && request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async loadController() {
    if (this.controller) {
      return this.controller;
    }

    const record = (await this.ctx.storage.get("record")) ?? null;
    this.controller = new GameRoomController({ record });
    return this.controller;
  }

  async save() {
    if (!this.controller?.record) {
      await this.ctx.storage.delete("record");
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.put("record", this.controller.record);
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    const timestamp = this.controller?.nextAlarmTime();
    if (!timestamp) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(timestamp);
  }

  async handleCreate(request) {
    const { gameId, origin, mode, difficulty } = await request.json();
    const controller = await this.loadController();
    const result =
      mode === "bot"
        ? controller.createBotGame({ gameId, origin, difficulty })
        : controller.createGame({ gameId, origin });

    await this.save();
    return json(result);
  }

  async handleCreateRematch(request) {
    const { gameId, origin, mode, difficulty } = await request.json();
    const controller = await this.loadController();
    const result = controller.createRematchGame({
      gameId,
      origin,
      mode,
      difficulty
    });

    await this.save();
    return json(result);
  }

  async handleWebSocket(request) {
    const controller = await this.loadController();
    const url = new URL(request.url);
    const playerToken = url.searchParams.get("playerToken") || null;
    const joinResult = controller.joinOrReconnect(playerToken);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    if (!joinResult.ok) {
      sendSocket(server, joinResult.expired ? "gameExpired" : "invalidMove", {
        reason: joinResult.reason
      });
      server.close(1008, joinResult.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    server.serializeAttachment({
      gameId: controller.gameState.id,
      player: joinResult.player,
      playerToken: joinResult.playerToken
    });
    await this.save();

    sendSocket(server, "gameJoined", {
      gameState: joinResult.gameState,
      playerToken: joinResult.playerToken,
      player: joinResult.player
    });
    this.broadcast(joinResult.reconnected ? "playerReconnected" : "gameUpdated", {
      gameState: controller.publicGameState
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(type, payload = {}, except = null) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) {
        continue;
      }

      try {
        sendSocket(ws, type, payload);
      } catch {
        // Dead sockets are cleaned up by the runtime close event.
      }
    }
  }

  socketsForPlayer(player, except = null) {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws === except) {
        return false;
      }

      return ws.deserializeAttachment()?.player === player;
    });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") {
      return;
    }

    const attachment = ws.deserializeAttachment();
    if (!attachment?.playerToken) {
      sendSocket(ws, "invalidMove", { reason: "Missing player token." });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      sendSocket(ws, "invalidMove", { reason: "Invalid message." });
      return;
    }

    const controller = await this.loadController();

    if (payload.type === "makeMove") {
      const result = controller.makeMove(attachment.playerToken, payload.pitIndex);
      if (!result.ok) {
        sendSocket(ws, "invalidMove", { reason: result.reason });
        return;
      }

      await this.save();
      this.broadcast("gameUpdated", { gameState: result.gameState });
      if (result.completed) {
        this.broadcast("gameCompleted", { gameState: result.gameState });
      }
      return;
    }

    if (payload.type === "requestGameState") {
      const result = controller.requestGameState(attachment.playerToken);
      if (!result.ok) {
        sendSocket(ws, "invalidMove", { reason: result.reason });
        return;
      }

      await this.save();
      sendSocket(ws, "gameJoined", result);
      this.broadcast("playerReconnected", { gameState: result.gameState }, ws);
      return;
    }

    if (payload.type === "requestRematch") {
      await this.handleRematchRequest(ws, controller, attachment.playerToken);
      return;
    }

    sendSocket(ws, "invalidMove", { reason: "Unknown message type." });
  }

  async handleRematchRequest(ws, controller, playerToken) {
    const result = controller.requestRematch(playerToken);
    if (!result.ok) {
      sendSocket(ws, "invalidMove", { reason: result.reason });
      return;
    }

    await this.save();

    if (result.pending) {
      this.broadcast("gameUpdated", { gameState: result.gameState });
      return;
    }

    this.broadcast("gameUpdated", { gameState: result.previousGameState });

    const gameId = createGameId();
    const room = getRoomStub(this.env, gameId);
    const response = await room.fetch("https://mancala-room/create-rematch", {
      method: "POST",
      body: JSON.stringify({
        gameId,
        origin: controller.record.origin || this.env.PUBLIC_APP_URL || "https://mancala-arena.workers.dev",
        mode: result.createRematch.mode,
        difficulty: result.createRematch.difficulty
      })
    });
    const rematch = await response.json();

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      const token = rematch.playerTokens[attachment?.player];
      if (!token) {
        continue;
      }

      sendSocket(socket, "gameCreated", {
        gameId: rematch.gameId,
        playerToken: token,
        player: attachment.player,
        joinUrl: rematch.joinUrl,
        gameState: rematch.gameState
      });
    }
  }

  async webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment();
    if (!attachment?.player) {
      ws.close(code, reason);
      return;
    }

    const controller = await this.loadController();
    if (!this.socketsForPlayer(attachment.player, ws).length) {
      controller.markConnected(attachment.player, false);
      await this.save();
      this.broadcast("playerDisconnected", { gameState: controller.publicGameState }, ws);
    }

    ws.close(code, reason);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws, 1011, "WebSocket error");
  }

  async alarm() {
    const controller = await this.loadController();

    if (!controller.record) {
      return;
    }

    if (controller.isExpired()) {
      this.broadcast("gameExpired", { reason: EXPIRED_GAME_REASON });
      this.controller.record = null;
      await this.save();
      for (const ws of this.ctx.getWebSockets()) {
        ws.close(1000, "Game expired");
      }
      return;
    }

    const botMoveAt = controller.record.botMoveAt ? new Date(controller.record.botMoveAt).getTime() : null;
    if (botMoveAt && botMoveAt <= Date.now()) {
      const result = controller.applyBotMove();
      if (result.ok) {
        await this.save();
        this.broadcast("gameUpdated", { gameState: result.gameState });
        if (result.completed) {
          this.broadcast("gameCompleted", { gameState: result.gameState });
        }
        return;
      }
    }

    await this.scheduleAlarm();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/games") {
      return createGame(request, env, "multiplayer");
    }

    if (request.method === "POST" && url.pathname === "/api/bot-games") {
      return createGame(request, env, "bot");
    }

    if (request.method === "GET" && url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const gameId = decodeURIComponent(url.pathname.slice("/ws/".length));
      if (!gameId) {
        return new Response("Missing game id", { status: 400 });
      }

      return getRoomStub(env, gameId).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
