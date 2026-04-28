import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { applyMove } from "./game/applyMove.js";
import { chooseBotMove } from "./game/chooseBotMove.js";
import { EXPIRED_GAME_REASON, InMemoryGameStore } from "./store/inMemoryGameStore.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = normalize(join(__dirname, "..", "public"));
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? null;
const store = new InMemoryGameStore();
const socketPlayers = new Map();
const botTurnTimers = new Map();
const cleanupIntervalMs = 60 * 1000;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function getPublicGameState(gameState) {
  if (!gameState) {
    return null;
  }

  return {
    ...gameState,
    players: {
      one: scrubPlayer(gameState.players.one),
      two: scrubPlayer(gameState.players.two)
    },
    board: {
      pits: [...gameState.board.pits]
    }
  };
}

function scrubPlayer(player) {
  if (!player) {
    return null;
  }

  return {
    id: player.id,
    connected: player.connected,
    isBot: Boolean(player.isBot)
  };
}

function emitState(io, gameId, eventName, gameState) {
  const publicState = getPublicGameState(gameState);
  io.to(gameId).emit(eventName, { gameState: publicState });
}

function isBotTurn(gameState) {
  return gameState?.mode === "bot" && gameState.status === "in_progress" && gameState.currentPlayer === "two";
}

function clearBotTimer(gameId) {
  const timer = botTurnTimers.get(gameId);
  if (timer) {
    clearTimeout(timer);
    botTurnTimers.delete(gameId);
  }
}

function publishMove(gameId, updatedState) {
  store.setGameState(gameId, updatedState);
  emitState(io, gameId, "gameUpdated", updatedState);

  if (updatedState.status === "completed") {
    emitState(io, gameId, "gameCompleted", updatedState);
    clearBotTimer(gameId);
    return;
  }

  scheduleBotTurn(gameId);
}

function scheduleBotTurn(gameId) {
  clearBotTimer(gameId);
  const gameState = store.getGameState(gameId);
  if (!isBotTurn(gameState)) {
    return;
  }

  const timer = setTimeout(() => {
    botTurnTimers.delete(gameId);
    const latestState = store.getGameState(gameId);
    if (!isBotTurn(latestState)) {
      return;
    }

    const pitIndex = chooseBotMove(latestState, "two", latestState.botDifficulty);
    if (pitIndex === null) {
      return;
    }

    try {
      publishMove(gameId, applyMove(latestState, "two", pitIndex));
    } catch {
      clearBotTimer(gameId);
    }
  }, 700);

  botTurnTimers.set(gameId, timer);
}

function getJoinUrl(socket, gameId) {
  const forwardedHost = socket.handshake.headers["x-forwarded-host"];
  const host = forwardedHost || socket.handshake.headers.host;
  const protocol = socket.handshake.headers["x-forwarded-proto"] || (host?.includes("localhost") ? "http" : "https");
  const origin = publicAppUrl || (host ? `${protocol}://${host}` : `http://localhost:${port}`);
  return `${origin}/?gameId=${encodeURIComponent(gameId)}`;
}

function cleanupExpiredGames() {
  for (const gameId of store.cleanupExpiredGames()) {
    clearBotTimer(gameId);
    io.to(gameId).emit("gameExpired", {
      reason: EXPIRED_GAME_REASON
    });
  }
}

async function serveStaticFile(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = normalize(join(publicDir, requestedPath));

  if (!safePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(safePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(safePath)) ?? "application/octet-stream"
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const httpServer = createServer(serveStaticFile);
const io = new Server(httpServer);

io.on("connection", (socket) => {
  socket.on("createGame", () => {
    const { gameId, playerToken, player, gameState } = store.createGame();
    socket.join(gameId);
    socketPlayers.set(socket.id, { gameId, player });
    store.setConnection(gameId, player, { socketId: socket.id, connected: true });

    socket.emit("gameCreated", {
      gameId,
      playerToken,
      player,
      joinUrl: getJoinUrl(socket, gameId),
      gameState: getPublicGameState(store.getGameState(gameId))
    });
  });

  socket.on("createBotGame", ({ difficulty } = {}) => {
    const { gameId, playerToken, player } = store.createBotGame({ socketId: socket.id, difficulty });
    socket.join(gameId);
    socketPlayers.set(socket.id, { gameId, player });

    socket.emit("gameCreated", {
      gameId,
      playerToken,
      player,
      joinUrl: getJoinUrl(socket, gameId),
      gameState: getPublicGameState(store.getGameState(gameId))
    });
  });

  socket.on("joinGame", ({ gameId, playerToken } = {}) => {
    const result = store.joinGame(gameId, playerToken);
    if (!result.ok) {
      socket.emit("invalidMove", { reason: result.reason });
      return;
    }

    socket.join(gameId);
    socketPlayers.set(socket.id, { gameId, player: result.player });
    const gameState = store.setConnection(gameId, result.player, { socketId: socket.id, connected: true });
    const publicState = getPublicGameState(gameState);

    socket.emit("gameJoined", {
      gameState: publicState,
      playerToken: result.playerToken,
      player: result.player
    });

    emitState(io, gameId, result.reconnected ? "playerReconnected" : "gameUpdated", gameState);
  });

  socket.on("makeMove", ({ gameId, playerToken, pitIndex } = {}) => {
    const player = store.getPlayerByToken(gameId, playerToken);
    if (!player) {
      const reason = store.getGameState(gameId) ? "Invalid player token." : store.getExpiredReason(gameId);
      socket.emit("invalidMove", { reason });
      return;
    }

    const gameState = store.getGameState(gameId);

    try {
      const updatedState = applyMove(gameState, player, pitIndex);
      publishMove(gameId, updatedState);
    } catch (error) {
      socket.emit("invalidMove", { reason: error.message });
    }
  });

  socket.on("requestGameState", ({ gameId, playerToken } = {}) => {
    const player = store.getPlayerByToken(gameId, playerToken);
    if (!player) {
      const reason = store.getGameState(gameId) ? "Invalid player token." : store.getExpiredReason(gameId);
      socket.emit("invalidMove", { reason });
      return;
    }

    socket.join(gameId);
    socketPlayers.set(socket.id, { gameId, player });
    const gameState = store.setConnection(gameId, player, { socketId: socket.id, connected: true });
    socket.emit("gameJoined", {
      gameState: getPublicGameState(gameState),
      playerToken,
      player
    });
    emitState(io, gameId, "playerReconnected", gameState);
    scheduleBotTurn(gameId);
  });

  socket.on("requestRematch", ({ gameId, playerToken } = {}) => {
    const result = store.requestRematch(gameId, playerToken);
    if (!result.ok) {
      socket.emit("invalidMove", { reason: result.reason });
      return;
    }

    if (result.pending) {
      emitState(io, gameId, "gameUpdated", result.gameState);
      return;
    }

    emitState(io, gameId, "gameUpdated", result.previousGameState);

    for (const player of ["one", "two"]) {
      const playerSocketId = result.gameState.players[player]?.socketId;
      const playerSocket = playerSocketId ? io.sockets.sockets.get(playerSocketId) : null;
      if (!playerSocket) {
        continue;
      }

      playerSocket.join(result.gameId);
      socketPlayers.set(playerSocket.id, { gameId: result.gameId, player });
      playerSocket.emit("gameCreated", {
        gameId: result.gameId,
        playerToken: result.playerTokens[player],
        player,
        joinUrl: getJoinUrl(playerSocket, result.gameId),
        gameState: getPublicGameState(result.gameState)
      });
    }

    scheduleBotTurn(result.gameId);
  });

  socket.on("disconnect", () => {
    const socketPlayer = socketPlayers.get(socket.id);
    if (!socketPlayer) {
      return;
    }

    socketPlayers.delete(socket.id);
    const currentPlayer = store.getGameState(socketPlayer.gameId)?.players[socketPlayer.player];
    if (currentPlayer?.socketId !== socket.id) {
      return;
    }

    const gameState = store.setConnection(socketPlayer.gameId, socketPlayer.player, {
      socketId: undefined,
      connected: false
    });

    if (gameState) {
      emitState(io, socketPlayer.gameId, "playerDisconnected", gameState);
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Mancala server listening at http://localhost:${port}`);
});

setInterval(cleanupExpiredGames, cleanupIntervalMs).unref();
