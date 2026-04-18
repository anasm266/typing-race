import { useState } from "react";
import { Link, useLocation } from "wouter";
import { createRoom } from "../lib/api";
import {
  DEFAULT_CONFIG,
  type EndMode,
  type PassageLength,
  type RoomConfig,
  type TimeLimit,
} from "../lib/protocol";

export function Home() {
  const [, setLocation] = useLocation();
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const { roomId } = await createRoom(config);
      setLocation(`/room/${roomId}`);
    } catch (e) {
      setError((e as Error).message ?? "failed");
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-12 w-full max-w-[560px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl md:text-4xl">race a friend</h2>
        <p className="text-fg-dim text-sm md:text-base">
          share one link. race starts in seconds. no signup.
        </p>
      </div>

      <div className="flex flex-col gap-6 w-full">
        <Field label="passage length">
          <PillGroup
            value={config.passageLength}
            options={
              [
                { value: "short", label: "short" },
                { value: "medium", label: "medium" },
                { value: "long", label: "long" },
              ] satisfies Array<{ value: PassageLength; label: string }>
            }
            onChange={(v) =>
              setConfig((c) => ({ ...c, passageLength: v }))
            }
          />
        </Field>

        <Field label="end mode">
          <PillGroup
            value={config.endMode}
            options={
              [
                { value: "finish", label: "finish passage" },
                { value: "time", label: "time limit" },
              ] satisfies Array<{ value: EndMode; label: string }>
            }
            onChange={(v) => setConfig((c) => ({ ...c, endMode: v }))}
          />
        </Field>

        {config.endMode === "time" && (
          <Field label="time limit">
            <PillGroup
              value={config.timeLimit}
              options={
                [
                  { value: 30, label: "30s" },
                  { value: 60, label: "60s" },
                  { value: 90, label: "90s" },
                ] satisfies Array<{ value: TimeLimit; label: string }>
              }
              onChange={(v) =>
                setConfig((c) => ({ ...c, timeLimit: v }))
              }
            />
          </Field>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 w-full">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-8 py-3 border border-accent text-accent text-lg hover:bg-accent hover:text-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? "creating..." : "create race"}
        </button>
        {error && (
          <span className="text-error text-sm">error: {error}</span>
        )}
        <Link
          href="/solo"
          className="text-xs text-fg-dim hover:text-accent transition-colors mt-2"
        >
          or practice alone →
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim">
        {label}
      </span>
      {children}
    </div>
  );
}

interface PillGroupProps<T extends string | number> {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}

function PillGroup<T extends string | number>({
  value,
  options,
  onChange,
}: PillGroupProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={
              "px-4 py-2 text-sm transition-colors border " +
              (selected
                ? "border-accent text-accent bg-accent/5"
                : "border-border text-fg-dim hover:border-fg-dim hover:text-fg")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
