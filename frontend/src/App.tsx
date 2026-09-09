/**
 * Routes, and the shell they sit in.
 *
 * A guest lands on the story rather than on a login wall: the game asks people
 * to spend money on a charity they have not heard of, and the argument for that
 * has to come before the sign-in does. So nothing here is gated except the page
 * that is only about you — Why, Play, Ledger and About are all open to a
 * stranger, and signing in is a choice they make when they want a bee.
 */

import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import Avatar from "./components/Avatar.tsx";
import { avatarFor } from "./lib/avatar";
import { PageBees } from "./components/Meadow.tsx";
import Meadowscape from "./components/Meadowscape.tsx";
import { useSession } from "./lib/session.ts";
import { useOperator } from "./lib/useOperator";
import About from "./pages/About.tsx";
import Ledger from "./pages/Ledger.tsx";
import Play from "./pages/Play.tsx";
import Operator from "./pages/Operator.tsx";
import Profile from "./pages/Profile.tsx";
import SignIn from "./pages/SignIn.tsx";
import Welcome from "./pages/Welcome.tsx";

/// Material Design 24dp paths, inline.
///
/// The rest of this app draws with lucide, and one bar in a second icon set is
/// a seam. It is here because Material was asked for by name, and because a
/// navigation bar is the one surface where an icon is doing signage rather than
/// decoration — say so in review if you would rather it matched the rest.
const MD = {
  why: "M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z",
  about: "M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z",
  ledger: "M19.5 3.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5zM19 19.09H5V4.91h14v14.18zM6 15h12v2H6zm0-4h12v2H6zm0-4h12v2H6z",
  play: "M21.58 16.09l-1.09-7.66C20.21 6.46 18.52 5 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19c.68 0 1.32-.27 1.8-.75L9 16h6l2.25 2.25c.48.48 1.13.75 1.8.75 1.56 0 2.75-1.37 2.53-2.91zM11 11H9v2H8v-2H6v-1h2V8h1v2h2v1zm4-1c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm2 3c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z",
  books: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z",
  signin: "M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z",
} as const;

/// Left to right, and the question marks are the point: three of these ASK
/// something and one of them tells you to go. `Play!` is the only imperative
/// on the bar.
const TABS = [
  { to: "/", label: "Why?", icon: MD.why },
  { to: "/about", label: "About?", icon: MD.about },
  { to: "/ledger", label: "Ledger", icon: MD.ledger },
  { to: "/play", label: "Play!", icon: MD.play },
];

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
    isActive ? "bg-ink/7 text-ink" : "text-ink/70 hover:text-ink/90"
  }`;

export default function App() {
  const session = useSession();
  const path = useLocation().pathname;
  // `/play` is a CHOICE before it is a board — two cards and a lot of empty
  // meadow — and excluding the whole route left the one screen that most looks
  // like it wants scenery without any. The page mounts its own while it is a
  // chooser, which is the component that actually knows; here the route stays
  // out of it so the two cannot both mount and double the bees.
  const onBoard = path.startsWith("/play");
  /// The long reads. They get ground at the FOOT rather than pinned to the
  /// viewport — see `Meadowscape`'s note on the difference, and on why a hill
  /// under three screens of prose about colony loss argues with the argument.
  const reading = ["/", "/about", "/ledger"].includes(path);
  // The operator gets one more tab. Drawn from what the service says its own
  // npub is, so a redeploy cannot leave a stale copy here disagreeing with it.
  const { isOperator } = useOperator(session.npub, session.signedIn);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-ink/14 px-2 py-1.5">
        {/* The wordmark goes on a phone; the bee stays. Five labelled
          * destinations and a brand do not fit 390px, and the bar was the one
          * thing on the board screen allowed to steal height from the board. */}
        <span className="shrink-0 px-2 text-sm font-semibold tracking-tight">
          🐝<span className="hidden sm:inline"> The Bee&rsquo;s Knees</span>
        </span>
        {/* Spread, rather than huddled at the right-hand end. `justify-evenly`
          * in a flexible middle gives each destination the same room and lets
          * the bar breathe on a tablet, where they used to sit in one corner
          * with two thirds of the width empty beside them. */}
        <div className="flex min-w-0 flex-1 items-center justify-evenly gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              title={t.label}
              aria-label={t.label}
              className={tabClass}
            >
              <Glyph d={t.icon} />
              {/* A help circle and an info circle are a poor pair to tell
                * apart at 18px, so both keep `title` and `aria-label` when the
                * word is gone. */}
              <span className="hidden sm:inline">{t.label}</span>
            </NavLink>
          ))}
          {isOperator && (
            <NavLink to="/operator" title="Books" aria-label="Books" className={tabClass}>
              <Glyph d={MD.books} />
              <span className="hidden sm:inline">Books</span>
            </NavLink>
          )}
        </div>

        {/* Your own face, or the way to get one. Deliberately the last thing on
         * the bar and never a wall in front of the others. */}
        {session.signedIn ? (
          <NavLink to="/profile" title="You" className="ml-1 rounded-lg p-0.5 hover:bg-ink/7">
            <Avatar value={avatarFor(session.npub)} size={26} />
          </NavLink>
        ) : (
          <NavLink to="/signin" title="Sign in" aria-label="Sign in" className={tabClass}>
            <Glyph d={MD.signin} />
            <span className="hidden sm:inline">Sign in</span>
          </NavLink>
        )}
      </nav>

      {/* A lapsed proof is routine — an hour with the tab open does it — so it
       * is a calm strip above the page, not a redirect that loses your place. */}
      {session.notice && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-[var(--color-wax-ink)]">
          <span className="flex-1">{session.notice}</span>
          <NavLink to="/signin" className="font-semibold underline">
            Sign in
          </NavLink>
          <button onClick={session.dismissNotice} className="text-[var(--color-wax-ink)]/70 hover:text-[var(--color-wax-ink)]">
            Dismiss
          </button>
        </div>
      )}

      {/* The wandering bees, on every page that has no board of its own.
        *
        * NOT on /play: that screen runs the same foragers inside the playfield,
        * where the hives paint over them so a loose bee can never be mistaken
        * for a racer. A second layer behind the whole app would put bees beside
        * the board with no such guarantee — a bee on the field that the rules
        * know nothing about, which is exactly what `Meadow` was written to
        * avoid. */}
      {!onBoard && <PageBees />}

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

        {/* Inside the scroller, after the page. Mounted here rather than by
          * each page because these pages are a narrow reading column and the
          * ground is not: dropped into the column it drew as a picture inset
          * in the text, and reaching full width from in there wants `100vw`,
          * which overshoots this scroller by the width of its own scrollbar.
          * A block child of the scroller is exactly as wide as the scroller. */}
        {reading && <Meadowscape anchor="foot" />}
      </div>
    </div>
  );
}
