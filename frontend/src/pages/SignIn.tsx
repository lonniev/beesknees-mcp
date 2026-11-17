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
import { LanguageChooser, NpubGate, useTour, type Session } from "@tollbooth-dpyc/web/react";
import { useT } from "../i18n/index.ts";

/** The languages, under the sign-in card: a guest chooses before they have an account to keep it in. */
export function Languages() {
  return (
    <div className="mx-auto mb-8 flex max-w-md justify-center px-4">
      <LanguageChooser />
    </div>
  );
}

export default function SignIn({ session }: { session: Session }) {
  const nav = useNavigate();
  const t = useT();
  const loc = useLocation();
  const nav_state = loc.state as { from?: string; generate?: boolean } | null;
  const back = nav_state?.from ?? "/profile";
  // The gate's tour is the package's: its field, its buttons, its strips.
  useTour("signin");

  return (
    <>
      <Meadowscape />
      <NpubGate
        welcome={t("signin.welcome")}
        notice={session.notice}
        startFresh={Boolean(nav_state?.generate)}
        onLogin={() => {
          session.refresh();
          nav(back, { replace: true });
        }}
      />
      <Languages />
    </>
  );
}
