import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { WORKER_URL } from "../lib/api";
import { formatPreciseElapsed } from "../lib/wpm";

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
    <div className="flex flex-col items-center gap-8 w-full max-w-[900px]">
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
        <div className="flex flex-col w-full gap-3">
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
  const oneWord = race.passage_length === "word" || race.passage_words === 1;
  const close = isCloseRace(race);
  const winnerLabel = tie ? "tie" : hostWon ? "host won" : "guest won";

  return (
    <article
      className={
        "group relative overflow-hidden border bg-bg-soft/35 px-4 py-4 transition-colors " +
        (close
          ? "border-accent/45 shadow-[0_0_36px_rgba(34,211,238,0.08)]"
          : "border-border hover:border-fg-dimmer")
      }
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.08),transparent_32%),radial-gradient(circle_at_85%_100%,rgba(244,114,182,0.07),transparent_32%)]" />

      <div className="relative grid gap-4 md:grid-cols-[7rem_1fr_auto] md:items-center">
        <div className="flex flex-row items-center justify-between gap-3 md:flex-col md:items-start md:justify-center">
          <span className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim tabular-nums">
            {timeAgo(race.finished_at)}
          </span>
          <span className="text-[0.65rem] text-fg-dimmer">
            {formatRaceTimeUtc(race.finished_at)}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={oneWord ? "one-word sprint" : race.passage_length}
              tone="accent"
            />
            <Badge
              label={modeLabel(race)}
              tone={
                race.end_reason === "disconnect" ? "opponent" : "muted"
              }
            />
            <Badge
              label={winnerLabel}
              tone={tie ? "muted" : hostWon ? "accent" : "opponent"}
            />
            {close && <Badge label="close race" tone="accent" pulse />}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <PlayerCell
              label="host"
              wpm={race.host_wpm}
              accuracy={race.host_accuracy}
              finished={race.host_finished === 1}
              winner={hostWon}
              tie={tie}
              oneWord={oneWord}
              align="left"
            />
            <span className="hidden text-center text-fg-dimmer sm:block">vs</span>
            <PlayerCell
              label="guest"
              wpm={race.guest_wpm}
              accuracy={race.guest_accuracy}
              finished={race.guest_finished === 1}
              winner={guestWon}
              tie={tie}
              oneWord={oneWord}
              align="right"
            />
          </div>
        </div>

        <div className="flex flex-row items-center justify-between gap-4 border-t border-border pt-3 md:flex-col md:items-end md:border-t-0 md:pt-0">
          {oneWord && (
            <div className="text-left md:text-right">
              <div className="text-[0.62rem] uppercase tracking-[0.16em] text-fg-dim">
                sprint duration
              </div>
              <div className="mt-1 tabular-nums text-fg">
                {formatPreciseElapsed(race.duration_ms)}
              </div>
            </div>
          )}
          <div className="text-right text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
            <div>
              {race.passage_words}{" "}
              {race.passage_words === 1 ? "word" : "words"}
            </div>
            <div className="text-fg-dimmer">{wpmDeltaLabel(race)}</div>
          </div>
        </div>
      </div>
    </article>
  );
}

function PlayerCell({
  label,
  wpm,
  accuracy,
  finished,
  winner,
  tie,
  oneWord,
  align,
}: {
  label: string;
  wpm: number;
  accuracy: number;
  finished: boolean;
  winner: boolean;
  tie: boolean;
  oneWord: boolean;
  align: "left" | "right";
}) {
  const color = winner
    ? "text-accent"
    : tie
    ? "text-fg"
    : "text-fg-dim";
  const alignment =
    align === "right" ? "sm:items-end sm:text-right" : "items-start text-left";
  return (
    <div className={`flex flex-col gap-1 ${alignment}`}>
      <span className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.17em] text-fg-dim">
        <span
          className={
            "inline-block size-1.5 rounded-full " +
            (label === "host" ? "bg-accent" : "bg-opponent")
          }
        />
        {label}
        {finished && <span className={color}>· finished</span>}
      </span>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`tabular-nums ${
            oneWord ? "text-2xl" : "text-xl"
          } ${color}`}
        >
          {wpm}
        </span>
        <span className="text-[0.6rem] uppercase tracking-[0.15em] text-fg-dimmer">
          wpm
        </span>
        <span className="text-xs tabular-nums text-fg-dim">
          {formatAccuracy(accuracy)}%
        </span>
      </div>
    </div>
  );
}

function Badge({
  label,
  tone,
  pulse = false,
}: {
  label: string;
  tone: "accent" | "opponent" | "muted";
  pulse?: boolean;
}) {
  const classes =
    tone === "accent"
      ? "border-accent/45 text-accent"
      : tone === "opponent"
      ? "border-opponent/45 text-opponent"
      : "border-border text-fg-dim";
  return (
    <span
      className={
        `border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.14em] ${classes}` +
        (pulse ? " animate-pulse" : "")
      }
    >
      {label}
    </span>
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
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(ms) + " UTC";
}

function modeLabel(race: RecentRace): string {
  switch (race.end_reason) {
    case "finish":
      return "finish";
    case "time_up":
      return "time";
    case "disconnect":
      return "forfeit";
  }
}

function isCloseRace(race: RecentRace): boolean {
  if (race.outcome === "tie") return true;
  const delta = Math.abs(race.host_wpm - race.guest_wpm);
  const oneWord = race.passage_length === "word" || race.passage_words === 1;
  if (oneWord) return delta <= 20;
  return delta <= 5 && race.host_accuracy >= 80 && race.guest_accuracy >= 80;
}

function wpmDeltaLabel(race: RecentRace): string {
  const delta = Math.abs(race.host_wpm - race.guest_wpm);
  return delta === 0 ? "even wpm" : `${delta} wpm gap`;
}

function formatAccuracy(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}
