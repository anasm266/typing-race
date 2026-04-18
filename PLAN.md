# Typing Speed Race — Project Plan

> A frictionless 2-player real-time typing race. Share a link → race in ≤10 seconds.
> Portfolio project targeting SWE internship/new-grad recruiters.

---

## 1. Guiding principles

- **Sharing IS the product.** No signup, no lobby. Link → race.
- **2 players only for v1.** 4-player is parked in §9.
- **Execution > scope.** Deploy it, test it, document it. A polished 80% beats an abandoned 120%.
- **Free forever at portfolio scale.** All infra on Cloudflare free tier.

---

## 2. Final feature scope

### v1 — MVP (must ship before calling it done)

Core race loop:
- [ ] US-01 Create race room (instant UUID URL)
- [ ] US-02 Configure race (end mode: passage-finish OR time-limit; length short/med/long; timer 30/60/90s)
- [ ] US-03 Join via link (no signup)
- [ ] US-04 Server-driven 3-2-1 countdown
- [ ] US-05 Zero-lag local keystroke feedback
- [ ] US-06 Opponent cursor live via WebSocket
- [ ] US-07 Live WPM counter (self + opponent)
- [ ] US-10 Race end + winner declaration
- [ ] US-11 Post-race WPM line graph (both players, sampled every 2s)
- [ ] US-12 Rematch button
- [ ] US-13 Disconnect handling (heartbeat + pause banner)
- [ ] US-14 Expired/invalid room screens

Quality / infra (the stuff recruiters actually notice):
- [ ] Deployed at a live URL that works on mobile + desktop
- [ ] README with architecture diagram + design decisions
- [ ] 30s demo GIF at top of README
- [ ] Basic integration tests (WebSocket sync happy path)
- [ ] Sentry error tracking wired on FE + BE
- [ ] Uptime monitor (Better Stack) linked from README
- [ ] k6 load test script + screenshot of results in README
- [ ] CI: GitHub Actions runs tests on PR, deploys on merge to main
- [ ] Reconnection logic (player's wifi blips → race resumes, not instant loss)
- [ ] Public `/recent` page showing last ~20 completed races (leaderboard-lite)

### v1.1 — polish (after MVP works end-to-end)

- [ ] US-08 Rhythm waveform (canvas, 60fps)
- [ ] US-09 Trash talk reaction bar + toasts
- [ ] Accessibility pass (keyboard nav for all menus, aria labels, color-contrast)
- [ ] Mobile layout refinements

### Parked for v2 / never (see §9)

- 4-player mode
- Accounts / persistent stats per user
- Public matchmaking queue
- Voice chat / webcams / anything requiring WebRTC

---

## 3. Finalized tech stack

### Frontend
- **React 18 + TypeScript + Vite**
- **Tailwind CSS** for styling
- **Zustand** for state (lighter than Redux, right size for this)
- **Canvas 2D API** for the rhythm waveform (no libraries — show raw skill)
- **uPlot or Recharts** for the post-race WPM graph (uPlot if we want perf cred, Recharts if we want fast)
- **native WebSocket API** (no socket.io — less magic, more signal to recruiters)

### Backend (all on Cloudflare)
- **Cloudflare Workers** — entry point, HTTP routes (`POST /room`, `GET /recent`, leaderboard reads)
- **Durable Objects** — one DO per room. Holds:
  - Both players' connection refs
  - Passage text, start time, end condition
  - Current cursor positions
  - WPM samples (every 2s per player)
  - Handles heartbeat / disconnect / rematch
  - Uses **WebSocket hibernation API** → zero cost when idle
- **D1 (SQLite)** — persisted completed races for `/recent`:
  - `races(id, finished_at, winner_wpm, loser_wpm, passage_len, duration_ms)`
  - Cap at ~10k rows, prune oldest on write
- **No other database needed.** Room state lives in the DO itself.

### Tooling / infra
- **Wrangler CLI** for Cloudflare deploys
- **GitHub Actions** for CI
- **Vitest** for unit tests, **Playwright** for one E2E smoke test
- **k6** (local) for WebSocket load test
- **Sentry** for errors (FE + Worker)
- **Better Stack** for uptime + status page
- *(optional)* **Grafana Cloud Free** for custom metrics if we want dashboards

---

## 4. Online services checklist

Sign up in this order. All free, no credit card required.

- [ ] **Cloudflare** — https://dash.cloudflare.com/sign-up
  - Enables Pages, Workers, Durable Objects, D1, all from one account
  - Install `wrangler` locally: `npm i -g wrangler` → `wrangler login`
- [ ] **GitHub** repo (already have) — make it **public** so recruiters can browse
- [ ] **Sentry** — https://sentry.io (choose Developer free plan)
  - Create 2 projects: `typing-race-web`, `typing-race-worker`
  - Grab DSN for each, store as repo secrets
- [ ] **Better Stack** — https://betterstack.com/uptime
  - Create monitor for production URL, 30s interval
  - Create public status page, link from README
- [ ] *(optional)* **Grafana Cloud Free** — https://grafana.com/products/cloud/
  - Only if you want dashboards; Workers Analytics Engine + CF dashboard may be enough

Nothing else. No DB service signup, no WebSocket SaaS, no VPS.

---

## 5. Free-tier headroom (so we know we won't get rate-limited)

| Resource | Free limit | Our expected usage | Margin |
|---|---|---|---|
| Workers requests | 100k/day | ~1k/day realistic portfolio traffic | 100× |
| Durable Objects requests | 100k/day | ~same | 100× |
| D1 reads | 5M/day | <1k/day | 5000× |
| D1 writes | 100k/day | <100/day | 1000× |
| D1 storage | 5 GB | <10 MB | huge |
| Pages bandwidth | generous (tens of GB) | <1 GB/month | big |
| Pages builds | 500/mo | <50/mo | 10× |
| Sentry errors | 5k/mo | hopefully <<5k | fine |

**If this ever goes viral** (it won't, but if): Cloudflare's paid tier is $5/mo and covers 10M requests. Not a concern.

---

## 6. Architecture notes (to flesh out in DESIGN.md later)

### Room lifecycle
```
POST /room            → Worker creates UUID, binds DO, returns {roomId, passageText}
WS /room/:id/ws       → Worker hands off to DO.fetch()
                        DO tracks which socket is host/challenger
Race end              → DO broadcasts final state, writes 1 row to D1
10 min after end      → DO self-destroys via alarm()
```

### Sync protocol (draft, finalize in design phase)
```
client → server:
  { t: "keystroke", pos: 42, correct: true, at: 169... }
  { t: "wpm_sample", wpm: 68, at: 169... }
  { t: "reaction", kind: "gg" }
  { t: "ping" }

server → client:
  { t: "opponent_pos", pos: 39 }
  { t: "opponent_wpm", wpm: 64 }
  { t: "toast", kind: "gg" }
  { t: "countdown", n: 3 }
  { t: "go" }
  { t: "end", winner: "host", stats: {...} }
  { t: "opponent_gone" }
  { t: "pong" }
```

### Anti-cheat (minimal)
- Server records start time; validates final WPM against (chars_typed / elapsed).
- Keystroke rate caps (>25 keys/sec = reject as bot).
- Doesn't need to be bulletproof — this is for friends, not ranked play.

### Reconnection
- Client stores `roomId + playerToken` in sessionStorage
- On socket drop: try reconnect 5× with backoff (1s, 2s, 4s, 8s, 16s)
- DO holds 30s grace window before marking player gone
- If reconnect succeeds: server replays missed events + resumes race

---

## 7. Milestones (rough — refine when we start building)

| # | Milestone | Done when | Status |
|---|---|---|---|
| M0 | Skeleton | Vite app + empty Worker deployed at live URL, both pingable | ✅ done |
| M1 | Single-player offline typing | Can type through a passage locally, WPM shown | ✅ done |
| M2 | Rooms + WebSocket join | Two browsers can join same room, basic "hello" echo | ✅ done |
| M3 | Live cursor sync | Both browsers see each other's cursor moving in real time | ✅ done |
| M4 | Countdown + race end + winner | Full race loop works, winner declared | ✅ done |
| M5 | WPM graph + rematch | Post-race screen shows graph, rematch button works | ⏭ next |
| M6 | Disconnect handling + expiry | Drop wifi mid-race → UI handles it gracefully | |
| M7 | Leaderboard + polish | `/recent` page live, README has GIF + k6 screenshot | |
| M8 | Waveform + trash talk | v1.1 polish features shipped | |
| M9 | Final QA | Mobile works, accessibility pass done, Sentry quiet | |

---

## 8. Resume-facing deliverables checklist

These are what actually get the callback. Do not skip.

- [ ] Live URL in README, one-click demo
- [ ] Demo GIF (30s) at top of README
- [ ] Architecture diagram in README (simple box-and-arrow, can be ASCII)
- [ ] "Design decisions" section: WebSockets vs SSE, DO vs Node.js server, state sync strategy
- [ ] "Performance" section with k6 numbers: `sustained N concurrent rooms at p95 <Xms`
- [ ] Link to Better Stack status page
- [ ] Concise one-paragraph project description for résumé itself (draft late)
- [ ] Public repo, green CI badge, passing tests

---

## 9. Parking lot — do NOT build in v1

Ideas worth remembering but out of scope for first ship. Revisit only after v1 is done, deployed, and on the résumé.

- **4-player mode** — cursor rendering layout, UI for 4 bars, topology work
- **Accounts + per-user stats** — requires real auth, persistent users, password resets, etc.
- **Global matchmaking / public queue** — conflicts with "sharing IS the product" thesis anyway
- **Typing passage variety** — custom passages, code snippets, quotes-from-books
- **Spectator mode** — third+ viewer that can watch but not play
- **Replay mode** — scrub through a completed race keystroke-by-keystroke
- **Bot opponent** — AI "ghost" trained on typing patterns for practice
- **Mobile swipe keyboard optimization** — tricky and most users will be desktop
- **i18n** — non-English passages
- **Sound effects** — keystroke clicks, whoosh on win

---

## 10. Decisions locked

- **WPM graph:** **Recharts** (nicer defaults, pairs well with dark Monkeytype-style UI)
- **Passages:** Curated static list in `/passages/` (~50 passages, varied lengths, Monkeytype-style prose). No API dep, deterministic for tests.
- **Page refresh mid-race:** Auto-reconnect with session token stored in `sessionStorage`. 30s grace window on the server. If refresh succeeds inside grace, race resumes. If grace expires, opponent sees "declare win / wait / end" options.
- **Visual style:** Monkeytype-*inspired layout* (dark bg, mono font, minimal chrome, single accent for correct-char highlight) but **own color identity** — **not** MT's signature yellow. Palette: near-black bg `#0a0a0b`, electric cyan accent `#22d3ee`, red for errors, green for ok/correct.

## 11. Still to decide (not blockers, punt when relevant)

- [ ] Confirm wrangler + Durable Objects work cleanly on Windows dev env (validate in M0)
- [ ] Exact color palette + typography (decide during M1, not now)
- [ ] Which 50 passages to curate (collect during M2)
