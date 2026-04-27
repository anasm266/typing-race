# typing-race

Real-time 2-player typing races built around one idea: sharing the link is the product.

Open a room, send it to a friend, and race immediately. No accounts, no lobby browsing, no queue. The project is hosted on Cloudflare's free tier and is meant to be both a usable game and a portfolio piece that shows real-time systems work, WebSocket state sync, and production-minded polish.

- Live app: [typing-race.pages.dev](https://typing-race.pages.dev)
- Recent races: [typing-race.pages.dev/recent](https://typing-race.pages.dev/recent)
- Analytics: [typing-race.pages.dev/analytics](https://typing-race.pages.dev/analytics)
- API health: [typing-race-api.kingzcopz266.workers.dev/health](https://typing-race-api.kingzcopz266.workers.dev/health)
- Analytics API: [typing-race-api.kingzcopz266.workers.dev/analytics](https://typing-race-api.kingzcopz266.workers.dev/analytics)
- Public status page: [typing-race.betteruptime.com](https://typing-race.betteruptime.com)

<!-- Add demo GIF here after recording. -->

## What it does

- Creates a shareable room URL instantly
- Drops the second player straight into the race flow
- Runs synchronized countdowns and live cursor/WPM updates over WebSockets
- Supports both finish-passage mode and time-limit mode
- Shows post-race results with a WPM-over-time graph
- Allows rematches without re-sharing the room
- Handles reconnects, disconnect grace periods, and room expiry
- Includes lightweight social UX with tap-only reaction toasts
- Publishes a public recent-races page backed by D1
- Tracks room funnel analytics like creates, joins, starts, completions, and pre-start drop-offs

## Why this project exists

Many typing games stop at a local timer and basic text highlighting. This one focuses on the harder engineering problems that make a multiplayer product feel real:

- low-latency local input with server-synced race state
- room lifecycle management and expiry
- reconnect-safe real-time sessions
- server-declared winners instead of trusting the client
- observability and load-testing for a live deployment

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4, wouter |
| Realtime | Cloudflare Workers + Durable Objects + WebSockets |
| Persistence | Cloudflare D1 (SQLite) for race history and room analytics |
| Charts | Recharts |
| Monitoring | Sentry, Better Stack |
| Load testing | k6 |
| Hosting | Cloudflare Pages + Workers free tier |

## Architecture

```text
Browser (React app on Cloudflare Pages)
  -> Worker routes HTTP and WebSocket upgrades
  -> Durable Object owns one room's live state
  -> D1 stores completed race summaries and room lifecycle analytics
```

Each room is managed by a single Durable Object instance. That instance is responsible for player joins, countdown timing, progress broadcasts, disconnect handling, winner calculation, rematch flow, and expiry alarms. The frontend keeps typing feedback local-first so keystrokes feel immediate, while the Worker remains the source of truth for multiplayer state.

## Feature highlights

### Real-time race flow

- Share-link room creation with no auth
- Server-driven countdown and race start
- Live opponent cursor and WPM
- Finish-mode and timed-mode races
- Server-side winner declaration and end screen

### Reliability and polish

- Session-preserving reconnect flow after refresh or brief network drops
- Grace periods for disconnects and finish-mode cleanup
- Clear invalid/full/expired room states
- Public recent-races page
- Public analytics page for real app-level usage tracking
- Better Stack uptime monitoring and Sentry error tracking

### Product feel

- Immediate local typing feedback on keydown
- Passage-based Ctrl+Backspace behavior
- Rematch without re-sharing
- Tap-only reaction bar and opponent toast notifications

## Repo structure

```text
.
|-- web/          Frontend app
|-- worker/       Worker, Durable Object, and D1 migrations
|-- load-tests/   k6 scenarios
`-- package.json  Workspace scripts
```

## Running locally

### Prerequisites

- Node.js 20+
- npm
- Wrangler CLI authenticated with Cloudflare

### Start the project

```bash
npm install
npm run dev:worker
npm run dev:web
```

By default:

- worker runs on `http://localhost:8787`
- web runs on `http://localhost:5173`

If needed, copy `web/.env.example` to `web/.env` and point `VITE_WORKER_URL` at your local or deployed Worker.

## Deployment

The app is designed to stay within Cloudflare's free tier.

```bash
# deploy the Worker
npm run deploy:worker

# build and deploy the frontend to Cloudflare Pages
npm run build:web
npm run deploy:web
```

When D1 schema changes, apply the migration from the `worker` package:

```bash
cd worker
wrangler d1 execute typing-race-db --file=migrations/0001_races.sql --remote
wrangler d1 execute typing-race-db --file=migrations/0002_room_analytics.sql --remote
wrangler d1 execute typing-race-db --file=migrations/0003_room_analytics_source.sql --remote
```

## Load testing

`load-tests/ws-rooms.js` contains a k6 scenario for concurrent room traffic over WebSockets. It creates rooms with `source: "load_test"` so synthetic traffic can be filtered out of public analytics and recent-race history.

Run it with local k6:

```bash
k6 run load-tests/ws-rooms.js
```

Or with Docker:

```bash
docker run --rm -i grafana/k6 run - < load-tests/ws-rooms.js
```

Write a local JSON summary (same as CI):

```bash
npm run k6:load
# or: k6 run --summary-export=k6-summary.json load-tests/ws-rooms.js
```

### Continuous runs (CI)

[`.github/workflows/k6-load-test.yml`](./.github/workflows/k6-load-test.yml) runs this scenario on a **weekly schedule** (Sundays 06:00 UTC), on **manual** workflow dispatch, and when `load-tests/` or the workflow file changes on `main`. Each run uploads a **`k6-summary` artifact** (JSON) you can download from the Actions run page, pass or fail, so you keep a simple history.

Required repository Variables (Settings -> Secrets and variables -> Actions -> Variables): `K6_API_URL` and `K6_WS_URL`. CI fails fast if either variable is missing or points at the production worker hostname.

## Standard CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. It installs dependencies with `npm ci` and runs:

```bash
npm run check
```

That command validates the repo with:

```bash
npm run lint:web
npm run build:web
npm run typecheck:worker
```
## Observability

- Sentry captures frontend errors plus Worker and Durable Object exceptions
- Better Stack monitors the public site and exposes a public status page
- Cloudflare tooling provides Worker logs and Durable Object metrics during debugging

## Current status

The project is fully playable and publicly deployed.

Completed:

- core single-player typing experience
- share-link multiplayer rooms
- synchronized countdowns and live cursor sync
- winner declaration and results flow
- WPM-over-time graph
- rematch flow
- reconnect/disconnect handling
- public recent-races page
- room funnel analytics page and API
- observability and k6 test coverage
- reaction bar polish

## Open source

Issues and suggestions are welcome. If you open a bug report, include:

- what you were trying to do
- the room URL shape you used
- whether it was local or production
- browser and device info
- screenshots or console errors if available

## License

This project is licensed under the MIT License. See [`LICENSE`](./LICENSE).
