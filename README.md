# typing-race

> Send a link. Race a friend. Winner takes pride.

A frictionless real-time 2-player typing race. No signup, no lobby, no queue — just a link that creates a live room and starts within 10 seconds.

- **Live app:** https://typing-race.pages.dev
- **API health:** https://typing-race-api.kingzcopz266.workers.dev/health
- **Status page:** _coming in M7_

---

## Features

- Share-link rooms — race starts from one texted URL
- Real-time opponent cursor via WebSocket (p95 < 80ms sync target)
- Zero-lag local keystroke feedback
- Live WPM counter, both players
- Post-race WPM-over-time line graph
- Live rhythm waveform under the input
- One-tap trash-talk reactions with toast notifications
- Auto-reconnect on wifi blips
- Public recent-races feed

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind |
| Realtime state | Cloudflare Durable Objects (one per room, WebSocket hibernation) |
| API / routing | Cloudflare Workers |
| Persistence | Cloudflare D1 (SQLite) for completed-race leaderboard |
| Hosting | Cloudflare Pages (FE) + Workers (BE) — single platform, free tier |
| Charts | Recharts |
| Testing | Vitest + Playwright + k6 (load) |
| Errors | Sentry |
| Uptime | Better Stack |
| CI | GitHub Actions |

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
           │  (routing + api)│      │  leaderboard   │
           └────────┬────────┘      └────────────────┘
                    │ fetch
                    ▼
           ┌─────────────────┐
           │  Durable Object │  one per room
           │  • players      │  • WS hibernation
           │  • cursors      │  • auto-destroy after race
           │  • WPM samples  │
           └─────────────────┘
```

Full design rationale: see [`PLAN.md`](./PLAN.md). Design doc will live at `DESIGN.md` once architecture is frozen.

## Repo layout

```
typing-race/
├── web/          # Vite + React frontend (deploys to Cloudflare Pages)
├── worker/       # Cloudflare Worker (HTTP + WebSocket API)
├── PLAN.md       # Feature scope, milestones, locked decisions
└── package.json  # npm workspaces root
```

## Local development

```bash
npm install

# terminal 1 — worker on http://localhost:8787
npm run dev:worker

# terminal 2 — web on http://localhost:5173
npm run dev:web
```

Set `web/.env` (copy from `.env.example`) if your local Worker isn't on the default port.

## Deployment

```bash
# worker
npm run deploy:worker

# web (builds + uploads to Cloudflare Pages)
npm run build:web && npm run deploy:web
```

Everything runs on Cloudflare's free tier. No credit card required.

## Project status

Current milestone: **M1 (single-player typing)** — next. See [`PLAN.md` §7](./PLAN.md#7-milestones-rough--refine-when-we-start-building) for the roadmap.

**Done:**
- M0 · scaffold · Vite+React frontend and Cloudflare Worker both deployed with end-to-end health check.

## License

MIT — see [`LICENSE`](./LICENSE).
