import { Link, Route, Switch } from "wouter";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";
import { Solo } from "./pages/Solo";
import { HealthPill } from "./components/HealthPill";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-fg">
      <header className="py-6 flex flex-col items-center">
        <Link
          href="/"
          className="text-2xl font-medium tracking-tight hover:text-accent transition-colors"
        >
          typing<span className="text-accent">_</span>race
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 pb-20">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/room/:id" component={Room} />
          <Route path="/solo" component={Solo} />
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
