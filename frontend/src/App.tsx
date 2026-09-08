/**
 * Routes, and the shell they sit in.
 *
 * A guest lands on the story rather than on a login wall: the game asks people
 * to spend money on a charity they have not heard of, and the argument for that
 * has to come before the sign-in does. So nothing here is gated except the page
 * that is only about you — Why, Play, Ledger and About are all open to a
 * stranger, and signing in is a choice they make when they want a bee.
 */

import { NavLink, Route, Routes } from "react-router-dom";
import Avatar from "./components/Avatar.tsx";
import { avatarFor } from "./lib/avatar";
import { useSession } from "./lib/session.ts";
import { useOperator } from "./lib/useOperator";
import About from "./pages/About.tsx";
import Ledger from "./pages/Ledger.tsx";
import Play from "./pages/Play.tsx";
import Operator from "./pages/Operator.tsx";
import Profile from "./pages/Profile.tsx";
import SignIn from "./pages/SignIn.tsx";
import Welcome from "./pages/Welcome.tsx";

const TABS = [
  { to: "/", label: "Why" },
  { to: "/play", label: "Play" },
  { to: "/ledger", label: "Ledger" },
  { to: "/about", label: "About" },
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm transition ${
    isActive ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
  }`;

export default function App() {
  const session = useSession();
  // The operator gets one more tab. Drawn from what the service says its own
  // npub is, so a redeploy cannot leave a stale copy here disagreeing with it.
  const { isOperator } = useOperator(session.npub, session.canSign);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <span className="px-2 text-sm font-semibold tracking-tight">🐝 The Bee's Knees</span>
        <div className="flex-1" />
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={tabClass}>
            {t.label}
          </NavLink>
        ))}
        {isOperator && (
          <NavLink to="/operator" className={tabClass}>
            Books
          </NavLink>
        )}

        {/* Your own face, or the way to get one. Deliberately the last thing on
         * the bar and never a wall in front of the others. */}
        {session.signedIn ? (
          <NavLink to="/profile" title="You" className="ml-1 rounded-lg p-0.5 hover:bg-white/10">
            <Avatar value={avatarFor(session.npub)} size={26} />
          </NavLink>
        ) : (
          <NavLink to="/signin" className={tabClass}>
            Sign in
          </NavLink>
        )}
      </nav>

      {/* A lapsed proof is routine — an hour with the tab open does it — so it
       * is a calm strip above the page, not a redirect that loses your place. */}
      {session.notice && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          <span className="flex-1">{session.notice}</span>
          <NavLink to="/signin" className="font-semibold underline">
            Sign in
          </NavLink>
          <button onClick={session.dismissNotice} className="text-amber-300/60 hover:text-amber-300">
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/play" element={<Play />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/about" element={<About />} />
          <Route path="/signin" element={<SignIn session={session} />} />
          <Route path="/profile" element={<Profile session={session} />} />
          {/* Always routed, never always linked. The page gates itself, and the
            * service gates it again — a route that only exists for some people
            * is a route that 404s confusingly for the rest. */}
          <Route path="/operator" element={<Operator session={session} />} />
          <Route path="*" element={<Welcome />} />
        </Routes>
      </div>
    </div>
  );
}
