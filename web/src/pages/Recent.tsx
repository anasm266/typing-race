import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { WORKER_URL } from "../lib/api";
import { seatTheme } from "../lib/seats";

interface RecentRacePlayer {
  seat: number;
  place: number;
  wpm: number;
  accuracy: number;
  elapsedMs: number;
  correctChars: number;
  finished: boolean;
  dnf: boolean;
}

interface RecentRace {
  id: string;
  finished_at: number;
  end_reason: "finish" | "time_up" | "disconnect" | "cap";
  outcome: string;
  passage_id: string;
  passage_length: string;
  passage_words: number;
  duration_ms: number;
  host_wpm: number;
  guest_wpm: number;
  host_accuracy: number;
  guest_accuracy: number;
  host_finished: number;
  guest_finished: number;
  player_count: number;
  winner_seat: number | null;
  players?: RecentRacePlayer[];
}

type Status =
  | { kind: "loading" }
  | { kind: "ok"; races: RecentRace[] }
  | { kind: "error"; message: string };

export function Recent() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  const loadRecent = useCallback((signal?: AbortSignal) => {
    fetch(`${WORKER_URL}/recent`, { cache: "no-store", signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { races: RecentRace[] };
        setStatus({ kind: "ok", races: data.races ?? [] });
      })
      .catch((err: Error) => {
        if (!signal?.aborted) {
          setStatus({ kind: "error", message: err.message });
        }
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadRecent(ctrl.signal);
    const interval = window.setInterval(() => loadRecent(), 15_000);

    function refreshIfVisible() {
      if (document.visibilityState === "visible") loadRecent();
    }

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      ctrl.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadRecent]);

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[800px]">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
          recent races
        </span>
        <h2 className="text-2xl">last 20 finished races</h2>
        <p className="text-xs text-fg-dimmer">
          every race that makes it to an end screen gets logged here
        </p>
      </header>

      {status.kind === "loading" && (
        <div className="text-sm text-fg-dim">loading...</div>
      )}

      {status.kind === "error" && (
        <div className="text-sm text-error">
          couldn't load recent races · {status.message}
        </div>
      )}

      {status.kind === "ok" && status.races.length === 0 && (
        <div className="text-sm text-fg-dim">
          no races yet · be the first
        </div>
      )}

      {status.kind === "ok" && status.races.length > 0 && (
        <div className="flex flex-col w-full divide-y divide-border">
          {status.races.map((r) => (
            <RaceRow key={r.id} race={r} />
          ))}
        </div>
      )}

      <Link
        href="/"
        className="text-xs text-fg-dim hover:text-accent transition-colors"
      >
        ← home
      </Link>
    </div>
  );
}

function RaceRow({ race }: { race: RecentRace }) {
  const tie = race.outcome === "tie";
  const players = seatsFor(race);

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-3">
      <span className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim w-20 tabular-nums">
        {timeAgo(race.finished_at)}
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm">
        {players.map((player, index) => (
          <span key={player.seat} className="flex items-center gap-3">
            {index > 0 && <span className="text-fg-dimmer">vs</span>}
            <PlayerCell
              seat={player.seat}
              wpm={player.wpm}
              winner={player.place === 1 && !player.dnf && !tie}
              tie={tie}
              dnf={player.dnf}
            />
          </span>
        ))}
      </div>

      <div className="flex flex-col items-end text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        <span>{race.passage_length}</span>
        <span className="text-fg-dimmer normal-case tracking-normal">
          {formatRaceTimeUtc(race.finished_at)}
        </span>
        <span className="text-fg-dimmer">
          {endReasonLabel(race.end_reason)}
        </span>
      </div>
    </div>
  );
}

/** Older rows predate race_players, so fall back to the seat 0/1 columns. */
function seatsFor(race: RecentRace): RecentRacePlayer[] {
  if (race.players && race.players.length > 0) return race.players;

  const hostWon = race.outcome === "host_wins";
  const guestWon = race.outcome === "guest_wins";
  return [
    {
      seat: 0,
      place: guestWon ? 2 : 1,
      wpm: race.host_wpm,
      accuracy: race.host_accuracy,
      elapsedMs: race.duration_ms,
      correctChars: 0,
      finished: race.host_finished === 1,
      dnf: false,
    },
    {
      seat: 1,
      place: hostWon ? 2 : 1,
      wpm: race.guest_wpm,
      accuracy: race.guest_accuracy,
      elapsedMs: race.duration_ms,
      correctChars: 0,
      finished: race.guest_finished === 1,
      dnf: false,
    },
  ];
}

function PlayerCell({
  seat,
  wpm,
  winner,
  tie,
  dnf,
}: {
  seat: number;
  wpm: number;
  winner: boolean;
  tie: boolean;
  dnf: boolean;
}) {
  const theme = seatTheme(seat);
  const color = winner ? theme.text : tie ? "text-fg" : "text-fg-dim";
  return (
    <div className="flex items-baseline gap-1 min-w-[72px]">
      <span
        className={`inline-block size-1.5 rounded-full self-center ${theme.bg} ${
          dnf ? "opacity-40" : ""
        }`}
        aria-hidden
      />
      <span className={`tabular-nums text-base ${color}`}>{wpm}</span>
      <span className="text-[0.6rem] uppercase tracking-[0.15em] text-fg-dimmer">
        wpm
      </span>
    </div>
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatRaceTimeUtc(ms: number): string {
  return (
    new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).format(ms) + " UTC"
  );
}

function endReasonLabel(reason: RecentRace["end_reason"]): string {
  switch (reason) {
    case "finish":
      return "finished";
    case "time_up":
      return "timeout";
    case "disconnect":
      return "forfeit";
    case "cap":
      return "time cap";
  }
}
