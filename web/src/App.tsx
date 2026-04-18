import { TypingRace } from "./components/TypingRace";
import { HealthPill } from "./components/HealthPill";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-fg">
      <header className="py-8 flex flex-col items-center">
        <h1 className="text-2xl font-medium tracking-tight">
          typing<span className="text-accent">_</span>race
        </h1>
        <p className="text-xs text-fg-dim mt-1 tracking-wide">
          share a link. race a friend.
        </p>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-20">
        <TypingRace />
      </main>

      <HealthPill />
    </div>
  );
}
