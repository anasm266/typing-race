import { useEffect, useState } from "react";

type HealthStatus =
  | { state: "loading" }
  | { state: "ok"; latencyMs: number; data: unknown }
  | { state: "error"; message: string };

const WORKER_URL =
  import.meta.env.VITE_WORKER_URL ?? "http://localhost:8787";

export default function App() {
  const [health, setHealth] = useState<HealthStatus>({ state: "loading" });

  useEffect(() => {
    const started = performance.now();
    fetch(`${WORKER_URL}/health`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setHealth({
          state: "ok",
          latencyMs: Math.round(performance.now() - started),
          data,
        });
      })
      .catch((err: Error) =>
        setHealth({ state: "error", message: err.message })
      );
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: "2.5rem", fontWeight: 600 }}>
          typing<span style={{ color: "var(--accent)" }}>_</span>race
        </h1>
        <p style={{ color: "var(--fg-dim)", marginTop: "0.5rem" }}>
          share a link. race a friend.
        </p>
      </header>

      <section
        style={{
          background: "var(--bg-soft)",
          padding: "1.5rem 2rem",
          borderRadius: "4px",
          minWidth: "320px",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "0.8rem",
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          worker health
        </h2>
        <div style={{ marginTop: "0.75rem", fontSize: "1rem" }}>
          {health.state === "loading" && (
            <span style={{ color: "var(--fg-dim)" }}>checking...</span>
          )}
          {health.state === "ok" && (
            <>
              <span style={{ color: "var(--ok)" }}>● ok</span>
              <span style={{ color: "var(--fg-dim)", marginLeft: "0.75rem" }}>
                {health.latencyMs}ms
              </span>
            </>
          )}
          {health.state === "error" && (
            <span style={{ color: "var(--error)" }}>
              ● {health.message}
            </span>
          )}
        </div>
        {health.state === "ok" && (
          <pre
            style={{
              marginTop: "1rem",
              textAlign: "left",
              fontSize: "0.8rem",
              color: "var(--fg-dim)",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(health.data, null, 2)}
          </pre>
        )}
      </section>

      <footer style={{ color: "var(--fg-dim)", fontSize: "0.85rem" }}>
        <code>M0 · scaffold</code>
        <span style={{ margin: "0 0.5rem" }}>·</span>
        <a
          href="https://github.com/anasm266/typing-race"
          target="_blank"
          rel="noreferrer"
        >
          github
        </a>
      </footer>
    </main>
  );
}
