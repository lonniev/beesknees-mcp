/**
 * Who you are here, and what you have to spend.
 *
 * Two things a player needs off the board and cannot get anywhere else: the
 * identity the hive knows them by, and the balance that decides whether the
 * next press does anything. They sit on one page because they are one question
 * — "am I ready to play?" — asked twice.
 */

import { LogOut } from "lucide-react";
import {
  AccountPage, BalanceAndTopUp, NpubGate, type Session, type UsageFigure, type UsageSummaryClassNames,
} from "@tollbooth-dpyc/web/react";
import Winnings from "../components/Winnings.tsx";
import Meadowscape from "../components/Meadowscape.tsx";
import { useTour } from "@tollbooth-dpyc/web/react";
import TutorialSwitch from "../components/TutorialSwitch.tsx";
import { decorateTile } from "../lib/tiles.tsx";
import { tour } from "../lib/tour.ts";
import { WELCOME } from "./SignIn.tsx";

/** A card on this page. Solid sky, because the meadow runs behind the page
 *  and text never sits on grass. */
const CARD = "rounded-xl border border-ink/14 bg-[var(--color-sky)] p-4";

/** The month only: the balance has its own card above, and lifetime totals
 *  under a "Last 30 days" heading would read as the month's. */
const MONTH: readonly UsageFigure[] = ["spent", "calls", "credited"];

/** The page's card, chip and ink ladder — the package draws, the hive dresses. */
const MONTH_LOOK: UsageSummaryClassNames = {
  root: CARD,
  header: "flex items-center justify-between",
  heading: "text-sm text-ink/78",
  chip: "rounded-lg border border-ink/20 px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/7 disabled:opacity-40",
  figures: "mt-3 grid grid-cols-3 gap-2",
  figure: "rounded-lg bg-ink/4 px-2 py-2",
  value: "text-lg font-semibold tabular-nums",
  label: "text-[11px] text-ink/65",
  subheading: "mt-4 text-xs font-semibold text-ink/78",
  list: "mt-1 divide-y divide-ink/10 text-sm",
  row: "flex items-baseline gap-2 py-1.5",
  loading: "mt-2 text-xs text-ink/65",
  error: "mt-2 text-xs text-ink/70",
  empty: "mt-3 text-xs text-ink/65",
};

/** A tool's name without the service's prefix: "fly", not "beesknees_fly". */
function toolName(tool: string): string {
  return tool.replace(/^beesknees_/, "").replace(/_/g, " ");
}

export default function Profile({ session }: { session: Session }) {
  useTour("account", { ready: session.signedIn });
  // Signed out, the page is the sign-in itself, on the meadow, and signing in
  // turns it into the profile in place. Drawn here rather than reached by
  // redirect, as on the honey page: a server render of it shows a door.
  if (!session.signedIn) {
    return (
      <>
        <Meadowscape />
        <NpubGate welcome={WELCOME} notice={session.notice} onLogin={() => session.refresh()} />
      </>
    );
  }

  return (
    <>
    {/* The ground under the page, as on sign-in: one column of cards in a lot
      * of sky. */}
    <Meadowscape />
    <AccountPage
      npub={session.npub}
      /* Identity first, and it is the panel's job: the avatar you can pick, the
       * name you can publish, the npub you can copy. The page keeps only what
       * the panel has no business knowing — how this session signs, and how to
       * end it. The session key is silent unless this tab holds one. */
      heading={null}
      between={{
        sessionKey: <div {...tour("account.balance")}><BalanceAndTopUp decorateTile={decorateTile} /></div>,
        usage: <div {...tour("account.winnings")}><Winnings npub={session.npub} /></div>,
      }}
      usage={{
        figures: MONTH,
        labels: { spent: "Spent", calls: "Moves & calls", credited: "Bought" },
        classNames: MONTH_LOOK,
        renderRow: (t) => (
          <>
            <span className="min-w-0 flex-1 truncate">{toolName(t.tool)}</span>
            <span className="text-xs text-ink/65 tabular-nums">
              {t.calls.toLocaleString("en-US")} {t.calls === 1 ? "call" : "calls"}
            </span>
            <span className="w-20 text-right tabular-nums">{t.sats.toLocaleString("en-US")} sats</span>
          </>
        ),
      }}
      timezone={{
        heading: null,
        label: "Time zone",
        note: () => "The times on the Ledger read in this zone.",
        classNames: {
          root: "flex flex-col gap-1.5",
          label: "text-sm text-ink/78",
          select:
            "w-full rounded-lg border border-ink/25 bg-white/70 px-3 py-2 text-sm focus:border-[var(--color-you-ink)] focus:outline-none",
        },
      }}
      // No theme toggle or build info here: the hive has one look, and its build
      // sits on About.
      theme={false}
      build={false}
      after={
        <>
        <TutorialSwitch />
        <div className={`${CARD} flex items-center gap-3 py-3`}>
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink/65">
            {session.canSign
              ? "Signing with a session key held in this tab."
              : "Signed in on a cached proof, which expires."}
          </span>
          <button
            onClick={session.signOut}
            {...tour("account.signout")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/20 px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/7"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
        </>
      }
      classNames={{
        root: "mx-auto max-w-lg space-y-6 px-4 py-6",
        section: CARD,
        sectionNote: "mt-2 text-xs text-ink/65",
      }}
    />
    </>
  );
}
