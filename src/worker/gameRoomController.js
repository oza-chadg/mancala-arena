import { applyMove } from "../game/applyMove.js";
import { chooseBotMove, normalizeBotDifficulty } from "../game/chooseBotMove.js";
import { createInitialGameState } from "../game/createInitialGameState.js";

export const GAME_EXPIRY_MS = {
  waiting: 24 * 60 * 60 * 1000,
  in_progress: 24 * 60 * 60 * 1000,
  completed: 2 * 60 * 60 * 1000
};

export const BOT_TURN_DELAY_MS = 700;
export const EXPIRED_GAME_REASON = "This invite has expired. Create a new game to keep playing.";

function defaultCreateId() {
  return globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function defaultCreateToken() {
  return globalThis.crypto.randomUUID();
}

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function scrubPlayer(player) {
  if (!player) {
    return null;
  }

  return {
    id: player.id,
    connected: Boolean(player.connected),
    isBot: Boolean(player.isBot)
  };
}

function clonePublicState(gameState) {
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
    },
    moveHistory: [...(gameState.moveHistory ?? [])]
  };
}

function buildJoinUrl(origin, gameId) {
  return `${origin.replace(/\/$/, "")}/?gameId=${encodeURIComponent(gameId)}`;
}

function createPlayerId(createId) {
  return `player_${createId()}`;
}

function getExpiryForStatus(status, now) {
  return addMilliseconds(now, GAME_EXPIRY_MS[status] ?? GAME_EXPIRY_MS.in_progress);
}

function withExpiry(gameState, now) {
  return {
    ...gameState,
    expiresAt: getExpiryForStatus(gameState.status, now)
  };
}

function isBotTurn(gameState) {
  return gameState?.mode === "bot" && gameState.status === "in_progress" && gameState.currentPlayer === "two";
}

function createHumanRecord({ gameId, now, createId, createToken, origin }) {
  const playerToken = createToken();
  const playerOneId = createPlayerId(createId);
  const gameState = withExpiry(
    createInitialGameState({
      id: gameId,
      playerOneId,
      now: now.toISOString()
    }),
    now
  );

  return {
    gameState,
    tokens: {
      one: playerToken,
      two: null
    },
    origin,
    botMoveAt: null
  };
}

function createBotRecord({ gameId, now, createId, createToken, origin, difficulty = "normal" }) {
  const playerToken = createToken();
  const playerOneId = createPlayerId(createId);
  const botDifficulty = normalizeBotDifficulty(difficulty);
  const gameState = withExpiry(
    {
      ...createInitialGameState({
        id: gameId,
        playerOneId,
        now: now.toISOString()
      }),
      status: "in_progress",
      mode: "bot",
      botDifficulty,
      players: {
        one: {
          id: playerOneId,
          connected: true
        },
        two: {
          id: "practice_bot",
          connected: true,
          isBot: true
        }
      },
      updatedAt: now.toISOString()
    },
    now
  );

  return {
    gameState,
    tokens: {
      one: playerToken,
      two: null
    },
    origin,
    botMoveAt: null
  };
}

function createTwoPlayerRematchRecord({ gameId, now, createId, createToken, origin }) {
  const gameState = createInitialGameState({
    id: gameId,
    playerOneId: createPlayerId(createId),
    now: now.toISOString()
  });

  return {
    gameState: withExpiry(
      {
        ...gameState,
        status: "in_progress",
        players: {
          one: {
            ...gameState.players.one,
            connected: false
          },
          two: {
            id: createPlayerId(createId),
            connected: false
          }
        },
        updatedAt: now.toISOString()
      },
      now
    ),
    tokens: {
      one: createToken(),
      two: createToken()
    },
    origin,
    botMoveAt: null
  };
}

/**
 * Cloudflare-independent controller for the one-game record owned by a
 * Durable Object. It returns public game states only; reconnect tokens stay in
 * the private record.
 */
export class GameRoomController {
  constructor({
    record = null,
    now = () => new Date(),
    random = Math.random,
    createId = defaultCreateId,
    createToken = defaultCreateToken
  } = {}) {
    this.record = record;
    this.now = now;
    this.random = random;
    this.createId = createId;
    this.createToken = createToken;
  }

  get gameState() {
    return this.record?.gameState ?? null;
  }

  get publicGameState() {
    return clonePublicState(this.gameState);
  }

  getPlayerByToken(playerToken) {
    if (!this.record || !playerToken) {
      return null;
    }

    if (this.record.tokens.one === playerToken) {
      return "one";
    }

    if (this.record.tokens.two === playerToken) {
      return "two";
    }

    return null;
  }

  createGame({ gameId = this.createId(), origin }) {
    const now = this.now();
    this.record = createHumanRecord({
      gameId,
      now,
      createId: this.createId,
      createToken: this.createToken,
      origin
    });

    return {
      gameId,
      playerToken: this.record.tokens.one,
      player: "one",
      joinUrl: buildJoinUrl(origin, gameId),
      gameState: this.publicGameState
    };
  }

  createBotGame({ gameId = this.createId(), origin, difficulty = "normal" }) {
    const now = this.now();
    this.record = createBotRecord({
      gameId,
      now,
      createId: this.createId,
      createToken: this.createToken,
      origin,
      difficulty
    });
    this.scheduleBotTurnIfNeeded(now);

    return {
      gameId,
      playerToken: this.record.tokens.one,
      player: "one",
      joinUrl: buildJoinUrl(origin, gameId),
      gameState: this.publicGameState
    };
  }

  createRematchGame({ gameId = this.createId(), origin, mode = "multiplayer", difficulty = "normal" }) {
    const now = this.now();
    this.record =
      mode === "bot"
        ? createBotRecord({
            gameId,
            now,
            createId: this.createId,
            createToken: this.createToken,
            origin,
            difficulty
          })
        : createTwoPlayerRematchRecord({
            gameId,
            now,
            createId: this.createId,
            createToken: this.createToken,
            origin
          });
    this.scheduleBotTurnIfNeeded(now);

    return {
      gameId,
      playerTokens: { ...this.record.tokens },
      joinUrl: buildJoinUrl(origin, gameId),
      gameState: this.publicGameState
    };
  }

  isExpired(now = this.now()) {
    return Boolean(this.gameState?.expiresAt) && new Date(this.gameState.expiresAt).getTime() <= now.getTime();
  }

  markConnected(player, connected) {
    if (!this.record?.gameState.players[player]) {
      return null;
    }

    const now = this.now();
    this.record.gameState = withExpiry(
      {
        ...this.record.gameState,
        players: {
          ...this.record.gameState.players,
          [player]: {
            ...this.record.gameState.players[player],
            connected
          }
        },
        updatedAt: now.toISOString()
      },
      now
    );

    return this.publicGameState;
  }

  joinOrReconnect(playerToken) {
    if (!this.record || this.isExpired()) {
      return { ok: false, reason: EXPIRED_GAME_REASON, expired: true };
    }

    const existingPlayer = this.getPlayerByToken(playerToken);
    if (existingPlayer) {
      this.markConnected(existingPlayer, true);
      return {
        ok: true,
        reconnected: true,
        player: existingPlayer,
        playerToken,
        gameState: this.publicGameState
      };
    }

    if (playerToken) {
      return { ok: false, reason: "Invalid player token." };
    }

    if (this.gameState.players.two) {
      return { ok: false, reason: "This game already has two players." };
    }

    const now = this.now();
    const newToken = this.createToken();
    this.record.tokens.two = newToken;
    this.record.gameState = withExpiry(
      {
        ...this.gameState,
        status: "in_progress",
        players: {
          ...this.gameState.players,
          two: {
            id: createPlayerId(this.createId),
            connected: true
          }
        },
        updatedAt: now.toISOString()
      },
      now
    );

    return {
      ok: true,
      reconnected: false,
      player: "two",
      playerToken: newToken,
      gameState: this.publicGameState
    };
  }

  requestGameState(playerToken) {
    const player = this.getPlayerByToken(playerToken);
    if (!player) {
      return { ok: false, reason: this.record ? "Invalid player token." : EXPIRED_GAME_REASON };
    }

    this.markConnected(player, true);
    return {
      ok: true,
      reconnected: true,
      player,
      playerToken,
      gameState: this.publicGameState
    };
  }

  makeMove(playerToken, pitIndex) {
    const player = this.getPlayerByToken(playerToken);
    if (!player) {
      return { ok: false, reason: this.record ? "Invalid player token." : EXPIRED_GAME_REASON };
    }

    try {
      const updatedState = applyMove(this.gameState, player, pitIndex, this.now().toISOString());
      this.record.gameState = withExpiry(updatedState, this.now());
      this.record.botMoveAt = null;
      this.scheduleBotTurnIfNeeded();
      return {
        ok: true,
        completed: this.gameState.status === "completed",
        gameState: this.publicGameState
      };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  applyBotMove() {
    if (!isBotTurn(this.gameState)) {
      this.record.botMoveAt = null;
      return { ok: false, reason: "It is not the bot's turn." };
    }

    const pitIndex = chooseBotMove(this.gameState, "two", this.gameState.botDifficulty, this.random);
    if (pitIndex === null) {
      this.record.botMoveAt = null;
      return { ok: false, reason: "Bot has no legal move." };
    }

    const now = this.now();
    this.record.gameState = withExpiry(applyMove(this.gameState, "two", pitIndex, now.toISOString()), now);
    this.record.botMoveAt = null;
    this.scheduleBotTurnIfNeeded(now);

    return {
      ok: true,
      completed: this.gameState.status === "completed",
      gameState: this.publicGameState
    };
  }

  scheduleBotTurnIfNeeded(now = this.now()) {
    if (!this.record) {
      return null;
    }

    if (!isBotTurn(this.gameState)) {
      this.record.botMoveAt = null;
      return null;
    }

    this.record.botMoveAt = addMilliseconds(now, BOT_TURN_DELAY_MS);
    return this.record.botMoveAt;
  }

  requestRematch(playerToken) {
    const player = this.getPlayerByToken(playerToken);
    if (!player) {
      return { ok: false, reason: "Invalid player token." };
    }

    if (this.gameState.status !== "completed") {
      return { ok: false, reason: "Rematch is available after the game is over." };
    }

    if (!this.gameState.players.two) {
      return { ok: false, reason: "Rematch requires two players." };
    }

    if (this.gameState.mode === "bot") {
      return {
        ok: true,
        pending: false,
        createRematch: {
          mode: "bot",
          difficulty: this.gameState.botDifficulty ?? "normal"
        },
        previousGameState: this.publicGameState
      };
    }

    const now = this.now();
    this.record.gameState = withExpiry(
      {
        ...this.gameState,
        rematchRequests: {
          one: this.gameState.rematchRequests?.one ?? false,
          two: this.gameState.rematchRequests?.two ?? false,
          [player]: true
        },
        updatedAt: now.toISOString()
      },
      now
    );

    if (!this.gameState.rematchRequests.one || !this.gameState.rematchRequests.two) {
      return {
        ok: true,
        pending: true,
        player,
        gameState: this.publicGameState
      };
    }

    return {
      ok: true,
      pending: false,
      createRematch: {
        mode: "multiplayer"
      },
      previousGameState: this.publicGameState
    };
  }

  nextAlarmTime() {
    if (!this.record) {
      return null;
    }

    const timestamps = [this.gameState?.expiresAt, this.record.botMoveAt]
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    return timestamps.length ? Math.min(...timestamps) : null;
  }
}
