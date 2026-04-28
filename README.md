# Mancala/Kalah Online

A small real-time Kalah app with two-player invites, reconnect tokens, rematches, bot practice, move history, and a mobile-friendly board. The rules engine stays pure JavaScript; the Cloudflare version stores each game in its own Durable Object and talks to the browser over raw WebSockets.

## Run Locally

```bash
npm install
npm test
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` starts Wrangler on port 3000, serves `public/` as Workers static assets, and runs the Worker/Durable Object backend locally.

## Cloudflare Deployment

The Cloudflare entrypoint is `src/worker/index.js`, configured by `wrangler.toml`.

```bash
npm run dev:cf
npm run deploy:cf
```

The Worker exposes:

- `POST /api/games` to create a two-player invite game
- `POST /api/bot-games` to create a solo practice game
- `GET /ws/:gameId?playerToken=...` for game WebSockets
- static assets from `public/`

Each `gameId` maps to one `GameRoom` Durable Object. The Durable Object owns private player tokens, game state, connection state, bot turns, rematches, expiry, and persistence. It uses Durable Object alarms for bot turns and stale-game cleanup so idle games can hibernate.

For GitHub Actions deployment, add these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Then push to `main` or run the **Deploy to Cloudflare Workers** workflow manually.

## Basic Flow

1. Click **Create Game**.
2. Share the invite link with another browser or device.
3. The second player opens the link and joins automatically.
4. Players click their own enabled pits to move.
5. Refreshing or reopening the same browser reconnects using the player token stored in `localStorage`.
6. The table shows turn state, connection state, recent move history, final results, and a two-player rematch request flow.

For solo practice, choose **Easy**, **Normal**, or **Hard**, then click **Play vs Bot**. The Durable Object seats a practice bot as player two and applies bot moves authoritatively after your turns.

## Project Shape

- `src/game/*` contains the pure Kalah rules engine.
- `src/worker/gameRoomController.js` contains the Cloudflare-independent game-room controller used by tests and the Durable Object.
- `src/worker/index.js` contains the Worker routes and `GameRoom` Durable Object.
- `public/*` contains the plain HTML/CSS/JS browser UI.
- `tests/*` covers the rules engine, bot move selection, rematches, and game-room controller behavior.

## WebSocket Protocol

Client messages:

- `{ "type": "makeMove", "pitIndex": 0 }`
- `{ "type": "requestGameState" }`
- `{ "type": "requestRematch" }`

Server messages:

- `{ "type": "gameCreated", "gameId": "...", "playerToken": "...", "joinUrl": "...", "gameState": {...} }`
- `{ "type": "gameJoined", "playerToken": "...", "player": "one", "gameState": {...} }`
- `{ "type": "gameUpdated", "gameState": {...} }`
- `{ "type": "gameCompleted", "gameState": {...} }`
- `{ "type": "playerDisconnected", "gameState": {...} }`
- `{ "type": "playerReconnected", "gameState": {...} }`
- `{ "type": "invalidMove", "reason": "..." }`
- `{ "type": "gameExpired", "reason": "..." }`

Public game state includes server-owned `moveHistory` and `rematchRequests`. Player tokens remain private and are only sent to the browser that owns that seat.
