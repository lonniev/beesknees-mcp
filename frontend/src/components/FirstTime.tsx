/**
 * What somebody needs before they can fund a bee, said to somebody who has
 * never held bitcoin and has never heard of Nostr.
 *
 * The Fund a Bee button used to send a first-timer to a sign-in form, which
 * asks for an npub before it has said what one is. Two unfamiliar words and a
 * text box is where a curious visitor stops.
 *
 * So: the two things they need, one paragraph each, in the plainest words that
 * are still true. No number is quoted that the operator can change — prices and
 * the beneficiary are runtime settings and a modal that hardcodes them is a
 * modal that goes stale.
 *
 * The wallet list is three apps people commonly start with, not a
 * recommendation and not an endorsement — this service takes nothing from any
 * of them, and says so, because a page that sends you to a money app owes you
 * that. They are deliberately different in kind: one mainstream account you may
 * already have, one that holds its own keys, one open source.
 */

import { useEffect, useRef } from "react";
import { ExternalLink, KeyRound, X, Zap } from "lucide-react";
import { LINK } from "../lib/ink";
import { Tx } from "@tollbooth-dpyc/web/react";
import { useT, WORDS, type MessageKey } from "../i18n/index.ts";

/**
 * Three starting points, different in kind on purpose, easiest first.
 *
 * Wallet of Satoshi leads on the operator's own experience of it: it is the
 * one with the least to understand before it works — no channels, no backup
 * ceremony, no decisions. That is the right first rung for somebody who has
 * never held bitcoin, and the other two are there for the person who reads the
 * first note and decides they would rather hold their own keys.
 */
const WALLETS: { name: string; url: string; note: MessageKey }[] = [
  {
    name: "Wallet of Satoshi",
    url: "https://www.walletofsatoshi.com/",
    note: "firstTime.wallet.wos",
  },
  {
    name: "Phoenix",
    url: "https://phoenix.acinq.co/",
    note: "firstTime.wallet.phoenix",
  },
  {
    name: "Blue Wallet",
    url: "https://bluewallet.io/",
    note: "firstTime.wallet.blue",
  },
];

export default function FirstTime({
  onGenerate,
  onExisting,
  onClose,
}: {
  /** Make a key for them, then sign them in with it. */
  onGenerate: () => void;
  /** They already have one — take them to the sign-in form. */
  onExisting: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const t = useT();

  // Escape closes, and the panel takes focus so a keyboard reader lands inside
  // the thing that just opened rather than behind it.
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-time-title"
        tabIndex={-1}
        // The backdrop closes; the panel must not, or every read is one
        // mis-tap from being dismissed.
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="first-time-title" className="text-lg font-semibold">
            {t("firstTime.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("firstTime.close")}
            className="-m-1 rounded-lg p-1 text-ink/60 hover:bg-ink/7"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-1 text-[13px] text-ink/70">
          {t("firstTime.intro")}
        </p>

        {/* ── 1. The money ─────────────────────────────────────────── */}
        <div className="mt-5 flex items-center gap-2">
          <Zap size={16} className="text-[var(--color-wax-ink)]" />
          <h3 className="text-sm font-semibold">{t("firstTime.wallet.title")}</h3>
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink/85">
          <Tx ns={WORDS} k="firstTime.wallet.body" components={{ b: <b /> }} />
        </p>
        <ul className="mt-3 space-y-2">
          {WALLETS.map((w) => (
            <li key={w.name} className="text-[13px]">
              <a href={w.url} target="_blank" rel="noreferrer noopener" className={LINK}>
                {w.name}
                <ExternalLink size={12} />
              </a>
              <span className="ml-2 text-ink/70">{t(w.note)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-ink/60">
          {t("firstTime.wallet.note")}
        </p>

        {/* ── 2. The name ──────────────────────────────────────────── */}
        <div className="mt-6 flex items-center gap-2">
          <KeyRound size={16} className="text-[var(--color-wax-ink)]" />
          <h3 className="text-sm font-semibold">{t("firstTime.key.title")}</h3>
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink/85">
          <Tx ns={WORDS} k="firstTime.key.body" components={{ b: <b /> }} />
        </p>

        <p className="mt-4 text-[12px] leading-relaxed text-ink/60">
          {t("firstTime.key.note")}
        </p>

        {/* ONE sticky block, and the buttons stay in a row inside it.
          *
          * On a phone the explanation runs past the fold, and somebody reading
          * it should never have to wonder whether there is a way out — the way
          * out is the point of the explanation. Two sticky blocks, or a stacked
          * pair of buttons, make this taller than the room left and it clips
          * the very thing it is holding down. */}
        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-ink/10 bg-white px-5 pb-2 pt-3">
          <button
            onClick={onGenerate}
            className="flex-1 rounded-xl bg-[var(--color-you)] px-3 py-3 text-[15px] font-semibold text-black"
          >
            {t("firstTime.make")}
          </button>
          <button
            onClick={onExisting}
            className="flex-1 rounded-xl border border-ink/20 px-3 py-3 text-[15px] text-ink/85 hover:bg-ink/4"
          >
            {t("firstTime.have")}
          </button>
        </div>

      </div>
    </div>
  );
}
