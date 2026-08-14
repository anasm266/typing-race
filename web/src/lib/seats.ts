import type { Seat } from "./protocol";

/**
 * Seat colors are fixed globally rather than relative to the viewer, so a
 * given racer looks the same to everyone — including spectators. "You" is
 * signalled with a label and ring instead of a private color, which keeps
 * reactions and standings readable in a four-way race.
 *
 * Class names are spelled out because Tailwind only picks up literals.
 */
export interface SeatTheme {
  seat: Seat;
  /** Short neutral name, e.g. "P2". */
  label: string;
  /** Raw CSS color, for inline styles like caret color. */
  color: string;
  text: string;
  bg: string;
  border: string;
  borderSoft: string;
  glow: string;
}

export const SEAT_THEMES: SeatTheme[] = [
  {
    seat: 0,
    label: "P1",
    color: "var(--color-seat-1)",
    text: "text-seat-1",
    bg: "bg-seat-1",
    border: "border-seat-1",
    borderSoft: "border-seat-1/45",
    glow: "shadow-[0_0_36px_rgba(34,211,238,0.10)]",
  },
  {
    seat: 1,
    label: "P2",
    color: "var(--color-seat-2)",
    text: "text-seat-2",
    bg: "bg-seat-2",
    border: "border-seat-2",
    borderSoft: "border-seat-2/45",
    glow: "shadow-[0_0_36px_rgba(244,114,182,0.10)]",
  },
  {
    seat: 2,
    label: "P3",
    color: "var(--color-seat-3)",
    text: "text-seat-3",
    bg: "bg-seat-3",
    border: "border-seat-3",
    borderSoft: "border-seat-3/45",
    glow: "shadow-[0_0_36px_rgba(251,191,36,0.10)]",
  },
  {
    seat: 3,
    label: "P4",
    color: "var(--color-seat-4)",
    text: "text-seat-4",
    bg: "bg-seat-4",
    border: "border-seat-4",
    borderSoft: "border-seat-4/45",
    glow: "shadow-[0_0_36px_rgba(167,139,250,0.10)]",
  },
];

export function seatTheme(seat: Seat): SeatTheme {
  return SEAT_THEMES[seat] ?? SEAT_THEMES[0];
}

/** "you" for the viewer's own seat, otherwise the neutral seat label. */
export function seatName(seat: Seat, mySeat: Seat | null): string {
  return seat === mySeat ? "you" : seatTheme(seat).label;
}
