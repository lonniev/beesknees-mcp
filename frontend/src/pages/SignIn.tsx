/**
 * The sign-in screen, and nothing else.
 *
 * A route rather than a wall across the app: a guest should be able to read why
 * the game exists, watch a round, and check the ledger without ever meeting
 * this page. It is reached when someone chooses to sign in, or when a paid
 * action needs an identity — and then it returns them to where they were.
 *
 * One card in the middle of a very large empty field read as a page that had
 * failed to load rather than a page that was calm, so the meadow is drawn
 * behind it. It is scenery in the strict sense: it takes no taps, holds no
 * text, and stops moving for anybody who asked for stillness.
 */

import { useLocation, useNavigate } from "react-router-dom";
import Meadowscape from "../components/Meadowscape.tsx";
import NpubGate from "../components/NpubGate.tsx";
import type { Session } from "../lib/session.ts";

export default function SignIn({ session }: { session: Session }) {
  const nav = useNavigate();
  const loc = useLocation();
  const back = (loc.state as { from?: string } | null)?.from ?? "/profile";

  return (
    <>
      <Meadowscape />
      <NpubGate
        notice={session.notice}
        onLogin={() => {
          session.refresh();
          nav(back, { replace: true });
        }}
      />
    </>
  );
}
