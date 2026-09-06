/**
 * Routes, and the shell they sit in.
 *
 * A guest lands on the story rather than on a login wall: the game asks people
 * to spend money on a charity they have not heard of, and the argument for that
 * has to come before the sign-in does.
 */

import { NavLink, Route, Routes } from "react-router-dom";
import About from "./pages/About.tsx";
import Ledger from "./pages/Ledger.tsx";
import Play from "./pages/Play.tsx";
import Welcome from "./pages/Welcome.tsx";

const TABS = [
  { to: "/", label: "Why" },
  { to: "/play", label: "Play" },
  { to: "/ledger", label: "Ledger" },
  { to: "/about", label: "About" },
];

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <span className="px-2 text-sm font-semibold tracking-tight">🐝 The Bee's Knees</span>
        <div className="flex-1" />
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/"}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm transition ${
                isActive ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/play" element={<Play />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Welcome />} />
        </Routes>
      </div>
    </div>
  );
}
