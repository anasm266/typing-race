import { useEffect, useState } from "react";

const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; latencyMs: number }
  | { kind: "error" };

export function HealthPill() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const started = performance.now();
    const ctrl = new AbortController();
    fetch(`${WORKER_URL}/health`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        setStatus({
          kind: "ok",
          latencyMs: Math.round(performance.now() - started),
        });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus({ kind: "error" });
      });
    return () => ctrl.abort();
  }, []);

  const color =
    status.kind === "ok"
      ? "text-ok"
      : status.kind === "error"
      ? "text-error"
      : "text-fg-dimmer";

  return (
    <div
      className="fixed bottom-3 right-3 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dimmer flex items-center gap-1.5 font-mono"
      title={
        status.kind === "ok"
          ? `worker ok · ${status.latencyMs}ms`
          : status.kind === "error"
          ? "worker unreachable"
          : "checking..."
      }
    >
      <span className={color}>●</span>
      <span>
        api
        {status.kind === "ok" && (
          <span className="text-fg-dim"> {status.latencyMs}ms</span>
        )}
      </span>
    </div>
  );
}
