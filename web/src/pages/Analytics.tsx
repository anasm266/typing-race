import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { WORKER_URL } from "../lib/api";

interface AnalyticsSummary {
  roomsCreated: number;
  roomsJoined: number;
  racesStarted: number;
  racesCompleted: number;
  racesDisconnected: number;
  preStartDrops: number;
}

interface AnalyticsDay {
  day: string;
  roomsCreated: number;
  roomsJoined: number;
  racesStarted: number;
  racesCompleted: number;
  preStartDrops: number;
}

type Status =
  | { kind: "loading" }
  | { kind: "ok"; summary: AnalyticsSummary; daily: AnalyticsDay[] }
  | { kind: "error"; message: string };

export function Analytics() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${WORKER_URL}/analytics`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as {
          summary: AnalyticsSummary;
          daily: AnalyticsDay[];
        };
        setStatus({
          kind: "ok",
          summary: data.summary,
          daily: data.daily ?? [],
        });
      })
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) {
          setStatus({ kind: "error", message: err.message });
        }
      });
    return () => ctrl.abort();
  }, []);

  const funnel = useMemo(() => {
    if (status.kind !== "ok") return null;
    const { summary } = status;
    const joinRate = percent(summary.roomsJoined, summary.roomsCreated);
    const startRate = percent(summary.racesStarted, summary.roomsCreated);
    const completionRate = percent(summary.racesCompleted, summary.racesStarted);
    return { joinRate, startRate, completionRate };
  }, [status]);

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[960px]">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
          analytics
        </span>
        <h2 className="text-2xl">room and race funnel</h2>
        <p className="text-xs text-fg-dimmer">
          tracks real room creation, second-player joins, starts, completions,
          and pre-start drop-offs
        </p>
      </header>

      {status.kind === "loading" && (
        <div className="text-sm text-fg-dim">loading...</div>
      )}

      {status.kind === "error" && (
        <div className="text-sm text-error">
          couldn't load analytics · {status.message}
        </div>
      )}

      {status.kind === "ok" && (
        <>
          <section className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="rooms created" value={status.summary.roomsCreated} />
            <MetricCard
              label="second player joined"
              value={status.summary.roomsJoined}
            />
            <MetricCard
              label="races started"
              value={status.summary.racesStarted}
            />
            <MetricCard
              label="races completed"
              value={status.summary.racesCompleted}
            />
            <MetricCard
              label="pre-start drops"
              value={status.summary.preStartDrops}
            />
            <MetricCard
              label="disconnect endings"
              value={status.summary.racesDisconnected}
            />
          </section>

          {funnel && (
            <section className="grid w-full gap-3 md:grid-cols-3">
              <MetricCard label="join rate" value={`${funnel.joinRate}%`} />
              <MetricCard label="start rate" value={`${funnel.startRate}%`} />
              <MetricCard
                label="completion rate"
                value={`${funnel.completionRate}%`}
              />
            </section>
          )}

          <section className="w-full border border-border">
            <div className="grid grid-cols-[1.1fr_repeat(5,minmax(0,1fr))] gap-3 border-b border-border px-4 py-3 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
              <span>day</span>
              <span className="text-right">created</span>
              <span className="text-right">joined</span>
              <span className="text-right">started</span>
              <span className="text-right">completed</span>
              <span className="text-right">drops</span>
            </div>

            {status.daily.length === 0 ? (
              <div className="px-4 py-6 text-sm text-fg-dim">
                no analytics yet
              </div>
            ) : (
              status.daily.map((day) => (
                <div
                  key={day.day}
                  className="grid grid-cols-[1.1fr_repeat(5,minmax(0,1fr))] gap-3 border-b border-border/70 px-4 py-3 text-sm last:border-b-0"
                >
                  <span className="text-fg">{formatDay(day.day)}</span>
                  <span className="text-right tabular-nums">
                    {day.roomsCreated}
                  </span>
                  <span className="text-right tabular-nums">
                    {day.roomsJoined}
                  </span>
                  <span className="text-right tabular-nums">
                    {day.racesStarted}
                  </span>
                  <span className="text-right tabular-nums">
                    {day.racesCompleted}
                  </span>
                  <span className="text-right tabular-nums text-opponent">
                    {day.preStartDrops}
                  </span>
                </div>
              ))
            )}
          </section>
        </>
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

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="border border-border bg-bg-soft/40 px-4 py-4">
      <div className="text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        {label}
      </div>
      <div className="mt-2 text-3xl tabular-nums text-fg">{value}</div>
    </div>
  );
}

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
