/**
 * The sign-in screen, and nothing else.
 *
 * A route rather than a wall across the app: a guest should be able to read why
 * the game exists, watch a round, and check the ledger without ever meeting
 * this page. It is reached when someone chooses to sign in, or when a paid
 * action needs an identity — and then it returns them to where they were.
 */

import { useLocation, useNavigate } from "react-router-dom";
import NpubGate from "../components/NpubGate.tsx";
import type { Session } from "../lib/session.ts";

export default function SignIn({ session }: { session: Session }) {
  const nav = useNavigate();
  const loc = useLocation();
  const back = (loc.state as { from?: string } | null)?.from ?? "/profile";

  return (
    <NpubGate
      notice={session.notice}
      onLogin={() => {
        session.refresh();
        nav(back, { replace: true });
      }}
    />
  );
}
