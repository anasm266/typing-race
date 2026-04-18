# typing-race

> Send a link. Race a friend. Winner takes pride.

A frictionless real-time 2-player typing race. No signup, no lobby, no queue — just a link that creates a live room and starts within 10 seconds.

- **Live app:** https://typing-race.pages.dev
- **Recent races:** https://typing-race.pages.dev/recent
- **API health:** https://typing-race-api.kingzcopz266.workers.dev/health
- **Status page (Better Stack):** https://typing-race.betteruptime.com

<!-- demo GIF goes here once recorded; see `docs/demo-gif.md` for instructions -->

---

## Features

- **Share-link rooms** — no signup, no lobby, no queue
- **Real-time opponent cursor** via WebSocket, animated on the shared passage
- **Zero-lag local keystroke feedback** — input responds on keydown, network is reconciled separately
- **Live WPM and accuracy** for both players as they type
- **Post-race WPM-over-time graph** (Recharts) comparing the two trajectories
- **Server-declared winner** — first finisher wins in finish mode, higher WPM at timer end wins in time mode
- **Rematch without re-sharing** — both click, new passage, countdown restarts
- **Auto-reconnect on wifi blips** — session tokens keep your role through reloads, 30s grace before forfeit
- **Trash-talk reactions** — one-tap emoji taunts toast on the opponent's screen
- **Public recent-races feed** backed by D1 (SQLite at the edge)

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8 + Tailwind v4 + wouter |
| Charts | Recharts |
| Realtime state | Cloudflare Durable Objects (one per room, WebSocket hibernation) |
| API / routing | Cloudflare Workers |
| Persistence | Cloudflare D1 (SQLite) for completed-race leaderboard |
| Hosting | Cloudflare Pages (FE) + Workers (BE) — single platform, free tier |
| Errors | Sentry (`@sentry/react` on FE, `@sentry/cloudflare` on Worker + DO) |
| Uptime | Better Stack |
| Load testing | k6 (WebSocket) — see `load-tests/` |

## Architecture

```
           ┌─────────────────┐
           │  Cloudflare     │
           │  Pages (React)  │
           └────────┬────────┘
                    │ WebSocket
                    ▼
           ┌─────────────────┐      ┌────────────────┐
           │  CF Worker      │─────▶│  D1 SQLite     │
           │  (routing + api)│      │  completed     │
           │                 │      │  races table   │
           └────────┬────────┘      └────────────────┘
                    │ fetch
                    ▼
           ┌─────────────────┐
           │  Durable Object │  one per room
           │  • players      │  • WS hibernation
           │  • cursors      │  • single alarm:
           │  • WPM samples  │    countdown / race-end /
           │  • race result  │    grace / expiry
           └─────────────────┘
```

Full design rationale and milestone log: see [`PLAN.md`](./PLAN.md).

## Repo layout

```
typing-race/
├── web/            # Vite + React frontend (deploys to Cloudflare Pages)
├── worker/         # Cloudflare Worker + Room Durable Object + D1 migrations
├── load-tests/     # k6 scripts
├── PLAN.md         # Feature scope, milestones, locked decisions
└── package.json    # npm workspaces root
```

## Local development

```bash
npm install

# terminal 1 — worker on http://localhost:8787
npm run dev:worker

# terminal 2 — web on http://localhost:5173
npm run dev:web
```

Copy `web/.env.example` → `web/.env` if your local Worker isn't on the default port.

## Deployment

```bash
# worker (deploys the DO, D1 migrations apply separately)
npm run deploy:worker

# web (builds + uploads to Cloudflare Pages)
npm run build:web && npm run deploy:web

# D1 schema (only when migrations change)
cd worker && wrangler d1 execute typing-race-db --file=migrations/0001_races.sql --remote
```

Everything runs on Cloudflare's free tier. No credit card required.

## Load testing

A k6 scenario ramps 25 concurrent rooms (2 WS each) for 60s against the deployed Worker, measures handshake latency, welcome success rate, and message round-trip time.

```bash
# with k6 installed locally:
k6 run load-tests/ws-rooms.js

# or via Docker (no local install):
docker run --rm -i grafana/k6 run - < load-tests/ws-rooms.js
```

Thresholds in the script: `welcome_ok > 98%`, `p95 round-trip < 300ms`, `HTTP error rate < 2%`.

<!-- paste k6 summary screenshot under here once a run is captured -->

## Observability

- **Sentry** — both FE and Worker+DO errors flow to the same Sentry org. DSNs are injected at deploy time (see `web/.env.production` and `worker/wrangler.jsonc`).
- **Better Stack** — pings `https://typing-race.pages.dev` every 30s, public status page linked above.
- **Cloudflare observability** — Worker tail via `wrangler tail`, DO metrics in the Cloudflare dashboard.

## Project status

Current milestone: **M9 (final QA)** — next. See [`PLAN.md` §7](./PLAN.md#7-milestones-rough--refine-when-we-start-building) for the roadmap.

**Done:**
- M0 · scaffold · Vite+React frontend and Cloudflare Worker both deployed with end-to-end health check.
- M1 · single-player typing · curated passages, live WPM/accuracy, char-by-char highlighting with blinking cyan caret, Tab loads next passage, end screen shows final stats.
- M2 · rooms + WebSocket join · Durable Objects per room with hibernation, share-link lobby, auto-selected URL + copy button, config picker (length/end-mode/time-limit), proper error screens for expired and full rooms.
- M3 · live cursor sync · auto-start with 2s buffer via DO alarm, progress broadcast on every keystroke, opponent cursor rendered in pink on the shared passage, live opponent WPM displayed.
- M4 · countdown + winner · animated 3-2-1-GO countdown, time-mode timer enforced via DO alarm, server-computed winner (first finisher in finish mode / higher WPM in time mode), role-aware EndScreen with win/lose/tie banner and side-by-side stats.
- M5 · WPM graph + rematch · Recharts line chart of both players' WPM over the race window, server-driven rematch flow (both click rematch → picks a new passage, clears race state, restarts countdown), keydown-capture-level preventDefault so Space doesn't scroll during the countdown.
- M6 · disconnect handling · per-room sessionStorage tokens so reloads keep their role, single-alarm scheduler handling countdown/race-end/grace/expiry, 30s grace on mid-race drop with server-side forfeit if the rival never comes back, automatic 10-minute room expiry after both players leave, client auto-reconnect with exponential backoff (500ms → 5s) preserving the last-seen room state during the retry.
- M7 · leaderboard + polish · D1 (SQLite) `races` table written on every race end, public `/recent` page showing last 20 finished races with WPM / accuracy / outcome / passage length, Sentry wired on FE + Worker + DO, Better Stack uptime monitor, k6 WebSocket load-test scenario.
- M8 · trash-talk bar · 6 pre-written reactions (👀 🐢 😬 🫠 🔥 💀) relayed through the Worker; opponent sees a pink top-of-screen toast for 2.5s, sender sees a brief button pulse, 3s per-button cooldown. Visible during countdown and live race only. **Waveform dropped** — vibe-only, no resume signal, higher maintenance cost than payoff.

## License

MIT — see [`LICENSE`](./LICENSE).
