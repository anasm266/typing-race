import { seatTheme } from "../lib/seats";
import type { Seat } from "../lib/protocol";

export interface RailPlayer {
  seat: Seat;
  name: string;
  wpm: number | null;
  /** 0..1 through the passage. */
  progress: number;
  finished: boolean;
  connected: boolean;
  isSelf: boolean;
}

const ROW_HEIGHT = 40;

/**
 * Live standings for a 3-4 racer field. Rows keep a stable DOM order and
 * are positioned by rank, so an overtake slides one row past another
 * instead of the list re-flowing under the reader.
 */
export function RaceRail({ players }: { players: RailPlayer[] }) {
  const ranked = [...players].sort(compareForRank);
  const rankBySeat = new Map(ranked.map((player, index) => [player.seat, index]));

  return (
    <div
      className="rail w-full"
      style={{ height: players.length * ROW_HEIGHT }}
      role="list"
      aria-label="race standings"
    >
      {players.map((player) => (
        <Row
          key={player.seat}
          player={player}
          rank={rankBySeat.get(player.seat) ?? 0}
        />
      ))}
    </div>
  );
}

function Row({ player, rank }: { player: RailPlayer; rank: number }) {
  const theme = seatTheme(player.seat);
  const pct = Math.max(0, Math.min(1, player.progress));

  return (
    <div
      role="listitem"
      className="rail-row grid grid-cols-[7.5rem_1fr_auto] items-center gap-4"
      style={{
        height: ROW_HEIGHT,
        transform: `translateY(${rank * ROW_HEIGHT}px)`,
        opacity: player.connected ? 1 : 0.45,
      }}
    >
      <span className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.15em] text-fg-dim">
        <span
          className={`inline-block size-1.5 rounded-full ${theme.bg}`}
          aria-hidden
        />
        <span className={player.isSelf ? theme.text : undefined}>
          {player.name}
        </span>
        {player.finished && (
          <span className="text-ok text-[0.6rem]">done</span>
        )}
        {!player.connected && !player.finished && (
          <span className="text-fg-dimmer text-[0.6rem]">away</span>
        )}
      </span>

      <span className="h-1 w-full overflow-hidden bg-bg-soft-2">
        <span
          className="rail-bar block h-full w-full"
          style={{
            background: theme.color,
            transform: `scaleX(${pct})`,
          }}
        />
      </span>

      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className={`text-lg ${theme.text}`}>
          {player.wpm === null ? "—" : player.wpm}
        </span>
        <span className="text-[0.6rem] uppercase tracking-[0.15em] text-fg-dim">
          wpm
        </span>
      </span>
    </div>
  );
}

function compareForRank(a: RailPlayer, b: RailPlayer): number {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.progress !== b.progress) return b.progress - a.progress;
  return (b.wpm ?? 0) - (a.wpm ?? 0);
}
