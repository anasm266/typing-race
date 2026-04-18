import { useEffect, useState } from "react";
import { Link } from "wouter";
import { WORKER_URL } from "../lib/api";

interface RecentRace {
  id: string;
  finished_at: number;
  end_reason: "finish" | "time_up" | "disconnect";
  outcome: "host_wins" | "guest_wins" | "tie";
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
}

type Status =
  | { kind: "loading" }
  | { kind: "ok"; races: RecentRace[] }
  | { kind: "error"; message: string };

export function Recent() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${WORKER_URL}/recent`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { races: RecentRace[] };
        setStatus({ kind: "ok", races: data.races ?? [] });
      })
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) {
          setStatus({ kind: "error", message: err.message });
        }
      });
    return () => ctrl.abort();
  }, []);

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
  const hostWon = race.outcome === "host_wins";
  const guestWon = race.outcome === "guest_wins";
  const tie = race.outcome === "tie";

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-3">
      <span className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim w-20 tabular-nums">
        {timeAgo(race.finished_at)}
      </span>

      <div className="flex items-center gap-3 font-mono text-sm">
        <PlayerCell
          label="host"
          wpm={race.host_wpm}
          accuracy={race.host_accuracy}
          finished={race.host_finished === 1}
          winner={hostWon}
          tie={tie}
        />
        <span className="text-fg-dimmer">vs</span>
        <PlayerCell
          label="guest"
          wpm={race.guest_wpm}
          accuracy={race.guest_accuracy}
          finished={race.guest_finished === 1}
          winner={guestWon}
          tie={tie}
        />
      </div>

      <div className="flex flex-col items-end text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        <span>{race.passage_length}</span>
        <span className="text-fg-dimmer">
          {endReasonLabel(race.end_reason)}
        </span>
      </div>
    </div>
  );
}

function PlayerCell({
  wpm,
  accuracy,
  finished,
  winner,
  tie,
}: {
  label: string;
  wpm: number;
  accuracy: number;
  finished: boolean;
  winner: boolean;
  tie: boolean;
}) {
  const color = winner
    ? "text-accent"
    : tie
    ? "text-fg"
    : "text-fg-dim";
  return (
    <div className="flex items-baseline gap-1 min-w-[72px]">
      <span className={`tabular-nums text-base ${color}`}>{wpm}</span>
      <span className="text-[0.6rem] uppercase tracking-[0.15em] text-fg-dimmer">
        wpm
      </span>
      {!finished && accuracy < 100 && (
        <span className="text-[0.6rem] text-fg-dimmer ml-1">
          {Math.round(accuracy)}%
        </span>
      )}
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

function endReasonLabel(reason: RecentRace["end_reason"]): string {
  switch (reason) {
    case "finish":
      return "finished";
    case "time_up":
      return "timeout";
    case "disconnect":
      return "forfeit";
  }
}
