import { useEffect } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";
import { Solo } from "./pages/Solo";
import { Recent } from "./pages/Recent";
import { Analytics } from "./pages/Analytics";
import { History } from "./pages/History";
import { Admin } from "./pages/Admin";
import { HealthPill } from "./components/HealthPill";
import { trackEvent } from "./lib/analytics";

export default function App() {
  const [location] = useLocation();

  useEffect(() => {
    trackEvent("page_view", { path: location });
  }, [location]);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-fg">
      <header className="py-6 px-4">
        <div className="mx-auto flex w-full max-w-[960px] items-center justify-between gap-4">
          <Link
            href="/"
            className="text-2xl font-medium tracking-tight hover:text-accent transition-colors"
          >
            typing<span className="text-accent">_</span>race
          </Link>

          <a
            href="https://github.com/anasm266/typing-race"
            target="_blank"
            rel="noreferrer"
            className="text-[0.7rem] uppercase tracking-[0.15em] text-fg-dim hover:text-accent transition-colors"
          >
            github ↗
          </a>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-20">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/room/:id" component={Room} />
          <Route path="/solo" component={Solo} />
          <Route path="/history" component={History} />
          <Route path="/recent" component={Recent} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/admin" component={Admin} />
          <Route>
            <div className="flex flex-col items-center gap-4 text-center">
              <h2 className="text-2xl">not found</h2>
              <Link
                href="/"
                className="text-accent hover:underline text-sm"
              >
                ← home
              </Link>
            </div>
          </Route>
        </Switch>
      </main>

      <HealthPill />
    </div>
  );
}
