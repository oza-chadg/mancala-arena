import { randomUUID } from "node:crypto";
import { normalizeBotDifficulty } from "../game/chooseBotMove.js";
import { createInitialGameState } from "../game/createInitialGameState.js";

export const GAME_EXPIRY_MS = {
  waiting: 24 * 60 * 60 * 1000,
  in_progress: 24 * 60 * 60 * 1000,
  completed: 2 * 60 * 60 * 1000
};

export const EXPIRED_GAME_REASON = "This invite has expired or the server restarted. Create a new game to keep playing.";

function createShortId() {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

function createToken() {
  return randomUUID();
}

function createPlayerId() {
  return `player_${createShortId()}`;
}

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds).toISOString();
}

/**
 * In-memory repository for the first version. Tokens are intentionally kept
 * outside the public game state so broadcasts never leak them.
 */
export class InMemoryGameStore {
  constructor() {
    this.games = new Map();
    this.expiredGameIds = new Set();
  }

  getNow() {
    return new Date();
  }

  getExpiryForStatus(status, now = this.getNow()) {
    return addMilliseconds(now, GAME_EXPIRY_MS[status] ?? GAME_EXPIRY_MS.in_progress);
  }

  withExpiry(gameState, now = this.getNow()) {
    return {
      ...gameState,
      expiresAt: this.getExpiryForStatus(gameState.status, now)
    };
  }

  isExpired(record, now = this.getNow()) {
    return Boolean(record?.gameState?.expiresAt) && new Date(record.gameState.expiresAt).getTime() <= now.getTime();
  }

  deleteGame(gameId) {
    this.games.delete(gameId);
    this.expiredGameIds.add(gameId);
  }

  getExpiredReason(gameId) {
    return this.expiredGameIds.has(gameId)
      ? EXPIRED_GAME_REASON
      : "Game not found.";
  }

  cleanupExpiredGames(now = this.getNow()) {
    const expiredGameIds = [];
    for (const [gameId, record] of this.games.entries()) {
      if (this.isExpired(record, now)) {
        this.deleteGame(gameId);
        expiredGameIds.push(gameId);
      }
    }

    return expiredGameIds;
  }

  createGame() {
    const gameId = createShortId();
    const playerToken = createToken();
    const playerOneId = createPlayerId();
    const now = this.getNow();
    const gameState = this.withExpiry(
      createInitialGameState({ id: gameId, playerOneId, now: now.toISOString() }),
      now
    );

    this.games.set(gameId, {
      gameState,
      tokens: {
        one: playerToken,
        two: null
      }
    });

    return { gameId, playerToken, player: "one", gameState };
  }

  createBotGame({ socketId, difficulty = "normal" } = {}) {
    const gameId = createShortId();
    const playerToken = createToken();
    const playerOneId = createPlayerId();
    const now = this.getNow();
    const botDifficulty = normalizeBotDifficulty(difficulty);
    const gameState = {
      ...createInitialGameState({ id: gameId, playerOneId, now: now.toISOString() }),
      status: "in_progress",
      mode: "bot",
      botDifficulty,
      players: {
        one: {
          id: playerOneId,
          socketId,
          connected: true
        },
        two: {
          id: "practice_bot",
          connected: true,
          isBot: true
        }
      },
      updatedAt: now.toISOString()
    };
    const expiringGameState = this.withExpiry(gameState, now);

    this.games.set(gameId, {
      gameState: expiringGameState,
      tokens: {
        one: playerToken,
        two: null
      }
    });

    return { gameId, playerToken, player: "one", gameState: expiringGameState };
  }

  createGameWithTwoPlayers(previousPlayers) {
    const gameId = createShortId();
    const now = this.getNow();
    const playerTokens = {
      one: createToken(),
      two: createToken()
    };
    const gameState = createInitialGameState({
      id: gameId,
      playerOneId: createPlayerId(),
      now: now.toISOString()
    });

    const rematchState = this.withExpiry({
      ...gameState,
      status: "in_progress",
      players: {
        one: {
          ...gameState.players.one,
          socketId: previousPlayers.one?.socketId,
          connected: previousPlayers.one?.connected ?? false
        },
        two: {
          id: createPlayerId(),
          socketId: previousPlayers.two?.socketId,
          connected: previousPlayers.two?.connected ?? false
        }
      },
      updatedAt: now.toISOString()
    }, now);

    this.games.set(gameId, {
      gameState: rematchState,
      tokens: playerTokens
    });

    return { gameId, playerTokens, gameState: rematchState };
  }

  getGame(gameId) {
    const record = this.games.get(gameId) ?? null;
    if (!record) {
      return null;
    }

    if (this.isExpired(record)) {
      this.deleteGame(gameId);
      return null;
    }

    return record;
  }

  getGameState(gameId) {
    return this.getGame(gameId)?.gameState ?? null;
  }

  setGameState(gameId, gameState) {
    const record = this.getGame(gameId);
    if (!record) {
      return null;
    }

    record.gameState = this.withExpiry(gameState);
    return record.gameState;
  }

  joinGame(gameId, playerToken) {
    const record = this.getGame(gameId);
    if (!record) {
      return { ok: false, reason: this.getExpiredReason(gameId) };
    }

    const existingPlayer = this.getPlayerByToken(gameId, playerToken);
    if (existingPlayer) {
      return { ok: true, player: existingPlayer, playerToken, gameState: record.gameState, reconnected: true };
    }

    if (record.gameState.players.two) {
      return { ok: false, reason: "This game already has two players." };
    }

    const newToken = createToken();
    const now = this.getNow();
    record.tokens.two = newToken;
    record.gameState = this.withExpiry({
      ...record.gameState,
      status: "in_progress",
      players: {
        ...record.gameState.players,
        two: {
          id: createPlayerId(),
          connected: true
        }
      },
      updatedAt: now.toISOString()
    }, now);

    return { ok: true, player: "two", playerToken: newToken, gameState: record.gameState, reconnected: false };
  }

  getPlayerByToken(gameId, playerToken) {
    if (!playerToken) {
      return null;
    }

    const record = this.getGame(gameId);
    if (!record) {
      return null;
    }

    if (record.tokens.one === playerToken) {
      return "one";
    }

    if (record.tokens.two === playerToken) {
      return "two";
    }

    return null;
  }

  setConnection(gameId, player, { socketId, connected }) {
    const record = this.getGame(gameId);
    if (!record || !record.gameState.players[player]) {
      return null;
    }

    const now = this.getNow();
    record.gameState = this.withExpiry({
      ...record.gameState,
      players: {
        ...record.gameState.players,
        [player]: {
          ...record.gameState.players[player],
          socketId,
          connected
        }
      },
      updatedAt: now.toISOString()
    }, now);

    return record.gameState;
  }

  requestRematch(gameId, playerToken) {
    const player = this.getPlayerByToken(gameId, playerToken);
    if (!player) {
      return { ok: false, reason: "Invalid player token." };
    }

    const record = this.getGame(gameId);
    if (!record) {
      return { ok: false, reason: this.getExpiredReason(gameId) };
    }

    if (record.gameState.status !== "completed") {
      return { ok: false, reason: "Rematch is available after the game is over." };
    }

    if (!record.gameState.players.two) {
      return { ok: false, reason: "Rematch requires two players." };
    }

    if (record.gameState.mode === "bot") {
      const rematch = this.createBotGame({
        socketId: record.gameState.players.one?.socketId,
        difficulty: record.gameState.botDifficulty
      });
      return {
        ok: true,
        pending: false,
        created: true,
        player,
        previousGameState: record.gameState,
        playerTokens: {
          one: rematch.playerToken,
          two: null
        },
        gameId: rematch.gameId,
        gameState: rematch.gameState
      };
    }

    const now = this.getNow();
    record.gameState = this.withExpiry({
      ...record.gameState,
      rematchRequests: {
        one: record.gameState.rematchRequests?.one ?? false,
        two: record.gameState.rematchRequests?.two ?? false,
        [player]: true
      },
      updatedAt: now.toISOString()
    }, now);

    if (!record.gameState.rematchRequests.one || !record.gameState.rematchRequests.two) {
      return { ok: true, pending: true, player, gameState: record.gameState };
    }

    const rematch = this.createGameWithTwoPlayers(record.gameState.players);
    return {
      ok: true,
      pending: false,
      created: true,
      player,
      previousGameState: record.gameState,
      ...rematch
    };
  }
}
