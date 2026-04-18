# typing-race

> Send a link. Race a friend. Winner takes pride.

A frictionless real-time 2-player typing race. No signup, no lobby, no queue — just a link that creates a live room and starts within 10 seconds.

**Live demo:** _coming soon_
**Status page:** _coming soon_

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

## Local development

_Not set up yet — coming in milestone M0._

```bash
# planned
npm install
npm run dev         # vite + wrangler dev in parallel
npm run test
npm run test:load   # k6 WebSocket load test
```

## Project status

Current milestone: **M0 (scaffold)**. See [`PLAN.md` §7](./PLAN.md#7-milestones-rough--refine-when-we-start-building) for the roadmap.

## License

MIT — see [`LICENSE`](./LICENSE).
