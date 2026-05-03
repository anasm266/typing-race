import { useState } from "react";
import { Link, useLocation } from "wouter";
import { createRoom } from "../lib/api";
import {
  getSavedPassageLength,
  savePassageLength,
} from "../lib/preferences";
import {
  DEFAULT_CONFIG,
  type EndMode,
  type PassageLength,
  type RoomConfig,
  type TimeLimit,
} from "../lib/protocol";

export function Home() {
  const [, setLocation] = useLocation();
  const [config, setConfig] = useState<RoomConfig>(() => ({
    ...DEFAULT_CONFIG,
    passageLength:
      getSavedPassageLength() ?? DEFAULT_CONFIG.passageLength,
  }));
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
    <div className="flex flex-col items-center gap-10 w-full max-w-[640px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl md:text-4xl">race a friend</h2>
        <p className="text-fg-dim text-sm md:text-base">
          create a room. send the link. your friend joins and the race
          starts in seconds.
        </p>
        <p className="text-fg-dimmer text-xs md:text-sm">
          no signup. anyone else with the same link can watch live as a
          spectator.
        </p>
      </div>

      <div
        aria-label="how it works"
        className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full"
      >
        <StepCard step="1" title="create" body="pick the race settings" />
        <StepCard step="2" title="send" body="drop one link in chat" />
        <StepCard
          step="3"
          title="race"
          body="two racers type while extras watch"
        />
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
              setConfig((c) => {
                savePassageLength(v);
                return { ...c, passageLength: v };
              })
            }
          />
        </Field>

        <Field label="end mode">
          <PillGroup
            value={config.endMode}
            options={
              [
                {
                  value: "finish",
                  label: "finish passage",
                  description:
                    "First to finish wins. After one racer finishes, the other gets 10 seconds to close the gap before the result locks.",
                },
                {
                  value: "time",
                  label: "time limit",
                  description:
                    "Race against the clock. When time runs out, the result is scored wherever both racers ended up, finished or not.",
                },
              ] satisfies Array<{
                value: EndMode;
                label: string;
                description: string;
              }>
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
        <div className="flex gap-4 text-xs text-fg-dim mt-2">
          <Link
            href="/solo"
            className="hover:text-accent transition-colors"
          >
            practice alone →
          </Link>
          <span className="text-fg-dimmer">·</span>
          <Link
            href="/recent"
            className="hover:text-accent transition-colors"
          >
            recent races →
          </Link>
          <span className="text-fg-dimmer">·</span>
          <Link
            href="/analytics"
            className="hover:text-accent transition-colors"
          >
            analytics →
          </Link>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="border border-border bg-bg-soft/40 px-4 py-3 text-left">
      <div className="flex items-center gap-2">
        <span className="text-[0.65rem] text-accent">0{step}</span>
        <span className="text-sm text-fg">{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-fg-dim">{body}</p>
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
  options: Array<{ value: T; label: string; description?: string }>;
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
          <span key={String(opt.value)} className="relative group">
            <button
              onClick={() => onChange(opt.value)}
              aria-describedby={
                opt.description ? `hint-${String(opt.value)}` : undefined
              }
              className={
                "px-4 py-2 text-sm transition-colors border " +
                (selected
                  ? "border-accent text-accent bg-accent/5"
                  : "border-border text-fg-dim hover:border-fg-dim hover:text-fg")
              }
            >
              {opt.label}
            </button>
            {opt.description && (
              <span
                id={`hint-${String(opt.value)}`}
                role="tooltip"
                className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-10 w-[min(21rem,calc(100vw-2rem))] border border-border bg-bg-soft px-3 py-2 text-left text-xs leading-relaxed text-fg-dim opacity-0 shadow-[0_12px_32px_rgba(0,0,0,0.35)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                {opt.description}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
