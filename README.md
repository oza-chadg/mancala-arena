# Mancala/Kalah Online

A small real-time two-player Kalah app. The Node.js server owns all game state, validates every move, applies the rules, and broadcasts safe public state through Socket.IO.

## Run Locally

```bash
npm install
npm test
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Fly.io

This repo includes a Dockerfile and `fly.toml` for a low-cost single-machine Fly deployment.

Before deploying, change the `app` value in `fly.toml` to a globally unique Fly app name. The default region is `syd`; change `primary_region` if you want the app closer to another player base.

```bash
fly auth login
fly launch --copy-config --name your-unique-app-name --region syd
fly deploy
fly scale count 1
```

The Fly config uses:

- one 256 MB shared CPU machine
- `auto_stop_machines = "suspend"`
- `auto_start_machines = true`
- `min_machines_running = 0`

That keeps idle cost low and lets Fly wake the app on traffic. Because game state is currently in memory, active games can be lost on deploys, cold starts, or any non-resumable machine restart. Keep the app to one machine until the store is moved to Redis or Postgres and Socket.IO is configured for multi-node operation.

## Deploy with GitHub Actions

The repository includes `.github/workflows/fly-deploy.yml`. It runs tests, then deploys to Fly.io on pushes to `main` and on manual workflow dispatch.

One-time setup:

```bash
git init -b main
git add .
git commit -m "Initial Mancala app"
fly auth login
fly launch --copy-config --name your-unique-app-name --region syd --no-deploy
fly tokens create deploy -x 999999h
```

Add the full token output as a GitHub repository secret named `FLY_API_TOKEN`, then push `main` to GitHub. Future pushes to `main` will run tests and deploy with `flyctl deploy --remote-only`.

## Basic Flow

1. Click **Create Game**.
2. Share the invite link with another browser or device.
3. The second player opens the link and joins automatically.
4. Players click their own enabled pits to move.
5. Refreshing or reopening the same browser reconnects using the player token stored in `localStorage`.
6. The table shows turn state, connection state, recent move history, final results, and a two-player rematch request flow.

For solo practice, choose **Easy**, **Normal**, or **Hard**, then click **Play vs Bot**. The server seats a practice bot as player two and applies the bot's moves authoritatively after your turns.

## Project Shape

- `src/game/*` contains the pure Kalah rules engine with no Socket.IO dependency.
- `src/store/inMemoryGameStore.js` contains in-memory game records and private player tokens.
- `src/server.js` serves the frontend and handles Socket.IO events.
- `public/*` contains the simple browser UI.
- `tests/gameRules.test.js` covers the deterministic rule engine behavior.

The store is deliberately isolated so it can later be replaced by Redis or Postgres without changing the rules engine.

## Socket.IO Events

Client to server:

- `createGame`
- `createBotGame`
- `joinGame { gameId, playerToken? }`
- `makeMove { gameId, playerToken, pitIndex }`
- `requestGameState { gameId, playerToken }`
- `requestRematch { gameId, playerToken }`

Server to client:

- `gameCreated { gameId, playerToken, joinUrl, gameState }`
- `gameJoined { gameState, playerToken, player }`
- `gameUpdated { gameState }`
- `invalidMove { reason }`
- `gameCompleted { gameState }`
- `playerDisconnected { gameState }`
- `playerReconnected { gameState }`

Public game state also includes server-owned `moveHistory` and `rematchRequests` fields. Player tokens remain private and are never broadcast to opponents.
