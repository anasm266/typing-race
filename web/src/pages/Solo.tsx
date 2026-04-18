import { Link } from "wouter";
import { TypingRace } from "../components/TypingRace";

export function Solo() {
  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <div className="flex items-center gap-3 text-[0.7rem] uppercase tracking-[0.2em] text-fg-dim">
        <Link href="/" className="hover:text-accent transition-colors">
          ← home
        </Link>
        <span className="text-fg-dimmer">·</span>
        <span>practice · offline</span>
      </div>
      <TypingRace />
    </div>
  );
}
