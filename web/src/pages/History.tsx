import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  clearLocalHistory,
  getLocalHistory,
  getLocalProfileId,
  type LocalHistoryEntry,
} from "../lib/localHistory";
import { formatPreciseElapsed } from "../lib/wpm";

export function History() {
  const [entries, setEntries] = useState<LocalHistoryEntry[]>(() =>
    getLocalHistory()
  );
  const [profileId] = useState(() => getLocalProfileId());

  useEffect(() => {
    function refresh() {
      setEntries(getLocalHistory());
    }
    window.addEventListener("typing-race:local-history", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("typing-race:local-history", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const raceEntries = entries.filter((entry) => entry.kind === "race");
  const bestWpm = max(entries.map((entry) => entry.wpm));
  const bestWord = min(
    entries
      .filter((entry) => entry.passageLength === "word")
      .map((entry) => entry.elapsedMs)
  );
  const raceWins = raceEntries.filter((entry) => entry.outcome === "win")
    .length;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[840px]">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
          your history
        </span>
        <h2 className="text-2xl">this browser profile</h2>
        <p className="max-w-[560px] text-xs text-fg-dimmer">
          stored locally on this device only. no account, no public
          leaderboard, no sync.
        </p>
        <span className="mt-1 text-[0.65rem] uppercase tracking-[0.18em] text-fg-dimmer">
          {profileId}
        </span>
      </header>

      <div className="grid w-full gap-3 sm:grid-cols-4">
        <SummaryCard label="runs" value={entries.length.toString()} />
        <SummaryCard label="best wpm" value={bestWpm?.toString() ?? "-"} />
        <SummaryCard
          label="best word"
          value={bestWord === null ? "-" : formatPreciseElapsed(bestWord)}
        />
        <SummaryCard
          label="race wins"
          value={`${raceWins}/${raceEntries.length}`}
        />
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-4 border border-border bg-bg-soft/40 px-8 py-10 text-center">
          <p className="text-sm text-fg-dim">
            no local results yet. finish a practice run or race to start
            building history.
          </p>
          <div className="flex gap-4 text-xs">
            <Link href="/solo" className="text-accent hover:underline">
              practice alone
            </Link>
            <Link href="/" className="text-accent hover:underline">
              create race
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col divide-y divide-border">
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-5 text-xs">
        <Link
          href="/"
          className="text-fg-dim hover:text-accent transition-colors"
        >
          {"<-"} home
        </Link>
        {entries.length > 0 && (
          <button
            onClick={() => clearLocalHistory()}
            className="text-fg-dimmer hover:text-error transition-colors"
          >
            clear local history
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-bg-soft/45 px-4 py-4">
      <div className="text-[0.65rem] uppercase tracking-[0.16em] text-fg-dim">
        {label}
      </div>
      <div className="mt-2 text-2xl tabular-nums text-fg">{value}</div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: LocalHistoryEntry }) {
  const isRace = entry.kind === "race";
  const closeRace =
    isRace &&
    entry.opponentWpm !== undefined &&
    Math.abs(entry.wpm - entry.opponentWpm) <= 5;

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-3">
      <span className="w-20 tabular-nums text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim">
        {timeAgo(entry.finishedAt)}
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={entry.kind} tone={isRace ? "opponent" : "accent"} />
          <Badge label={entry.passageLength} tone="muted" />
          {entry.endMode && <Badge label={entry.endMode} tone="muted" />}
          {closeRace && <Badge label="close race" tone="accent" />}
        </div>

        <div className="flex flex-wrap items-baseline gap-3 font-mono text-sm">
          <Metric value={entry.wpm.toString()} label="wpm" tone="accent" />
          <Metric value={`${formatAccuracy(entry.accuracy)}%`} label="acc" />
          <Metric value={formatPreciseElapsed(entry.elapsedMs)} label="time" />
          {isRace && entry.opponentWpm !== undefined && (
            <>
              <span className="text-fg-dimmer">vs</span>
              <Metric
                value={entry.opponentWpm.toString()}
                label="rival wpm"
                tone="opponent"
              />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        {entry.outcome && (
          <span className={outcomeColor(entry.outcome)}>
            {entry.outcome}
          </span>
        )}
        <span>{entry.passageWords} words</span>
        <span className="text-fg-dimmer">
          {formatClock(entry.finishedAt)}
        </span>
      </div>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "accent" | "opponent" | "muted";
}) {
  const classes =
    tone === "accent"
      ? "border-accent/40 text-accent"
      : tone === "opponent"
      ? "border-opponent/40 text-opponent"
      : "border-border text-fg-dim";
  return (
    <span
      className={`border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.14em] ${classes}`}
    >
      {label}
    </span>
  );
}

function Metric({
  value,
  label,
  tone = "muted",
}: {
  value: string;
  label: string;
  tone?: "accent" | "opponent" | "muted";
}) {
  const color =
    tone === "accent"
      ? "text-accent"
      : tone === "opponent"
      ? "text-opponent"
      : "text-fg";
  return (
    <span className="flex items-baseline gap-1">
      <span className={`tabular-nums ${color}`}>{value}</span>
      <span className="text-[0.6rem] uppercase tracking-[0.13em] text-fg-dimmer">
        {label}
      </span>
    </span>
  );
}

function max(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

function min(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.min(...values);
}

function formatAccuracy(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function outcomeColor(outcome: NonNullable<LocalHistoryEntry["outcome"]>) {
  if (outcome === "win") return "text-accent";
  if (outcome === "lose") return "text-opponent";
  return "text-fg";
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

function formatClock(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}
