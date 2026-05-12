import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { WORKER_URL } from "../lib/api";

type Range = "24h" | "7d" | "30d";

interface AdminAnalytics {
  range: Range;
  summary: {
    visitors: number;
    sessions: number;
    pageViews: number;
    roomsCreated: number;
    playersJoined: number;
    spectatorsJoined: number;
    racesStarted: number;
    racesCompleted: number;
    completionRate: number;
  };
  funnel: {
    pageViews: number;
    roomsCreated: number;
    playersJoined: number;
    racesStarted: number;
    racesCompleted: number;
    visitToCreateRate: number;
    playerJoinRate: number;
    startRate: number;
    completionRate: number;
  };
  series: Array<{
    bucket: string;
    events: number;
    visitors: number;
    pageViews: number;
    roomsCreated: number;
    racesStarted: number;
    racesCompleted: number;
  }>;
  topReferrers: GroupRow[];
  topCountries: GroupRow[];
  topPages: GroupRow[];
  devices: GroupRow[];
  browsers: GroupRow[];
  recentEvents: Array<{
    id: string;
    eventAt: number;
    eventName: string;
    browserId: string | null;
    sessionId: string | null;
    roomId: string | null;
    participantKind: string | null;
    playerRole: string | null;
    path: string | null;
    referrerHost: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
    source: string;
    metadata: Record<string, unknown> | null;
  }>;
}

interface GroupRow {
  label: string;
  count: number;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: AdminAnalytics }
  | { kind: "error"; message: string };

const TOKEN_KEY = "typing-race.admin-token.v1";

export function Admin() {
  const [token, setToken] = useState(() => getStoredToken());
  const [draftToken, setDraftToken] = useState(() => getStoredToken());
  const [range, setRange] = useState<Range>("7d");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    fetch(`${WORKER_URL}/admin/analytics?range=${range}`, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as AdminAnalytics;
        setStatus({ kind: "ok", data });
      })
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) {
          setStatus({ kind: "error", message: err.message });
        }
      });
    return () => ctrl.abort();
  }, [range, token]);

  function saveToken() {
    const trimmed = draftToken.trim();
    setStatus({ kind: "loading" });
    setToken(trimmed);
    try {
      window.sessionStorage.setItem(TOKEN_KEY, trimmed);
    } catch {
      // token remains in React state for this page.
    }
  }

  function clearToken() {
    setToken("");
    setDraftToken("");
    setStatus({ kind: "idle" });
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex w-full max-w-[1120px] flex-col gap-8">
      <header className="flex flex-col gap-3 text-center">
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
          private admin
        </span>
        <h2 className="text-2xl">website and race analytics</h2>
        <p className="text-xs text-fg-dimmer">
          hidden dashboard. token required. no raw IPs or typed text.
        </p>
      </header>

      {!token && (
        <section className="mx-auto flex w-full max-w-[520px] flex-col gap-3 border border-border bg-bg-soft/40 p-5">
          <label className="text-[0.65rem] uppercase tracking-[0.16em] text-fg-dim">
            admin token
          </label>
          <input
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveToken();
            }}
            type="password"
            className="border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            autoFocus
          />
          <button
            onClick={saveToken}
            className="border border-accent px-4 py-2 text-sm text-accent transition-colors hover:bg-accent hover:text-bg"
          >
            open dashboard
          </button>
        </section>
      )}

      {token && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {(["24h", "7d", "30d"] satisfies Range[]).map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    setStatus({ kind: "loading" });
                    setRange(option);
                  }}
                  className={
                    "border px-3 py-1.5 text-xs transition-colors " +
                    (range === option
                      ? "border-accent text-accent"
                      : "border-border text-fg-dim hover:border-fg-dim hover:text-fg")
                  }
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              onClick={clearToken}
              className="text-xs text-fg-dimmer transition-colors hover:text-error"
            >
              forget token
            </button>
          </div>

          {status.kind === "loading" && (
            <div className="text-center text-sm text-fg-dim">loading...</div>
          )}

          {status.kind === "error" && (
            <div className="border border-error/50 bg-error-soft px-4 py-3 text-sm text-error">
              couldn't load admin analytics · {status.message}
            </div>
          )}

          {status.kind === "ok" && <Dashboard data={status.data} />}
        </>
      )}
    </div>
  );
}

function Dashboard({ data }: { data: AdminAnalytics }) {
  const maxSeries = Math.max(...data.series.map((row) => row.events), 1);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Metric label="visitors" value={data.summary.visitors} />
        <Metric label="sessions" value={data.summary.sessions} />
        <Metric label="page views" value={data.summary.pageViews} />
        <Metric label="rooms" value={data.summary.roomsCreated} />
        <Metric label="players" value={data.summary.playersJoined} />
        <Metric label="spectators" value={data.summary.spectatorsJoined} />
        <Metric label="started" value={data.summary.racesStarted} />
        <Metric label="completed" value={data.summary.racesCompleted} />
        <Metric label="completion" value={`${data.summary.completionRate}%`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="activity">
          <div className="flex flex-col gap-2">
            {data.series.length === 0 && (
              <div className="py-6 text-sm text-fg-dim">no events yet</div>
            )}
            {data.series.map((row) => (
              <div key={row.bucket} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-xs">
                <span className="truncate text-fg-dim">{formatBucket(row.bucket)}</span>
                <div className="h-2 overflow-hidden bg-bg-soft-2">
                  <div
                    className="h-full bg-accent"
                    style={{
                      width: `${Math.max(4, (row.events / maxSeries) * 100)}%`,
                    }}
                  />
                </div>
                <span className="tabular-nums text-fg">{row.events}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="funnel">
          <div className="grid gap-2 text-sm">
            <FunnelRow label="page views" value={data.funnel.pageViews} />
            <FunnelRow
              label="rooms created"
              value={data.funnel.roomsCreated}
              rate={`${data.funnel.visitToCreateRate}%`}
            />
            <FunnelRow
              label="players joined"
              value={data.funnel.playersJoined}
              rate={`${data.funnel.playerJoinRate}%`}
            />
            <FunnelRow
              label="races started"
              value={data.funnel.racesStarted}
              rate={`${data.funnel.startRate}%`}
            />
            <FunnelRow
              label="races completed"
              value={data.funnel.racesCompleted}
              rate={`${data.funnel.completionRate}%`}
            />
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <GroupTable title="referrers" rows={data.topReferrers} />
        <GroupTable title="countries" rows={data.topCountries} />
        <GroupTable title="pages" rows={data.topPages} />
        <GroupTable title="devices" rows={data.devices} />
        <GroupTable title="browsers" rows={data.browsers} />
      </section>

      <Panel title="recent events">
        <div className="flex flex-col divide-y divide-border">
          {data.recentEvents.length === 0 && (
            <div className="py-6 text-sm text-fg-dim">no events yet</div>
          )}
          {data.recentEvents.map((event) => (
            <div
              key={event.id}
              className="grid gap-3 py-3 text-xs lg:grid-cols-[10rem_1fr_1fr_1fr]"
            >
              <div className="text-fg-dim">
                <div>{timeAgo(event.eventAt)}</div>
                <div className="text-fg-dimmer">{formatTime(event.eventAt)}</div>
              </div>
              <div>
                <div className="text-accent">{event.eventName}</div>
                <div className="text-fg-dimmer">
                  {event.path ?? "-"} {event.roomId ? `· ${event.roomId.slice(0, 8)}` : ""}
                </div>
              </div>
              <div className="text-fg-dim">
                <div>{event.browserId ?? "unknown browser"}</div>
                <div className="text-fg-dimmer">
                  {event.participantKind ?? "visitor"}
                  {event.playerRole ? ` · ${event.playerRole}` : ""}
                </div>
              </div>
              <div className="text-fg-dim">
                <div>
                  {[event.city, event.region, event.country]
                    .filter(Boolean)
                    .join(", ") || "unknown location"}
                </div>
                <div className="text-fg-dimmer">
                  {[event.browser, event.os, event.device]
                    .filter(Boolean)
                    .join(" · ") || "unknown device"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border bg-bg-soft/40 px-4 py-4">
      <div className="text-[0.62rem] uppercase tracking-[0.16em] text-fg-dim">
        {label}
      </div>
      <div className="mt-2 text-3xl tabular-nums text-fg">{value}</div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-border bg-bg-soft/25 p-4">
      <h3 className="mb-4 text-[0.7rem] uppercase tracking-[0.18em] text-fg-dim">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FunnelRow({
  label,
  value,
  rate,
}: {
  label: string;
  value: number;
  rate?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-dim">{label}</span>
      <span className="tabular-nums text-fg">
        {value}
        {rate && <span className="ml-2 text-xs text-fg-dimmer">{rate}</span>}
      </span>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <Panel title={title}>
      <div className="flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="py-4 text-sm text-fg-dim">no data</div>
        )}
        {rows.map((row) => (
          <div
            key={`${title}-${row.label}`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="truncate text-fg-dim">{row.label}</span>
            <span className="tabular-nums text-fg">{row.count}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function getStoredToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

function formatBucket(bucket: string): string {
  if (bucket.includes("T")) {
    return new Date(bucket).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    });
  }
  return new Date(`${bucket}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
