/**
 * The guest welcome — what this is, and why it exists.
 *
 * It opens for somebody who knows nothing: not one word of jargon before the
 * reader has been told what they are looking at. "A race to the queen" meant
 * nothing to a first-time visitor, and neither did "most of what a round
 * collects" — both assumed a game the reader had not yet been told about.
 *
 * The opening four paragraphs are the CODE OWNER'S OWN WORDS, kept as written.
 * Two edits only, both agreed: the racer is a drone rather than an unspecified
 * bee, and the money fights the viral contamination rather than supporting it,
 * which was a slip of a single verb. The beneficiary is "the current pollinator
 * conservation society chosen for support" in his own restatement — lowercase
 * and descriptive, because "Pollinator Society" capitalised reads as the name
 * of an organisation and there is no such body.
 *
 * Below the introduction, written to be checkable. Every claim is one a reader
 * could look up and find, and where the science is qualified the sentence is
 * qualified too. The page argues for the charity by being accurate about which
 * bees are actually in trouble, which is a stronger case than the one most bee
 * campaigns make.
 *
 * The opener and that argument are not in perfect register — it says "native
 * bee populations in the US and UK" while the sections below distinguish
 * honeybee livestock from the wild species nobody keeps. That is the owner's
 * call, made knowingly: a welcome may speak broadly where an argument must be
 * precise.
 */

import { Link } from "react-router-dom";
import { useCharity } from "../components/CharityNote.tsx";
import LossChart from "../components/LossChart.tsx";
import WildVsManaged from "../components/WildVsManaged.tsx";
import { Art } from "../art/svg.tsx";
import { Tx } from "@tollbooth-dpyc/web/react";
import { useT, WORDS } from "../i18n/index.ts";

export default function Welcome() {
  // The beneficiary is the operator's to choose and can change, so the page
  // reads the live one rather than carrying a name that quietly goes stale.
  const who = useCharity();
  const t = useT();
  const inkLink = "text-[var(--color-wax-ink)] underline decoration-dotted underline-offset-4";

  return (
    <div className="mx-auto max-w-[90rem] px-5 py-10 leading-relaxed">
      <h1 className="text-3xl font-semibold tracking-tight">The Bee's Knees</h1>
      <div className="mt-4 space-y-4 text-[15px] text-ink/90">
        <p>{t("welcome.p1")}</p>
        <p>{t("welcome.p2")}</p>
        <p>
          {who?.name ? (
            <Tx ns={WORDS} k="welcome.p3Named" vars={{ name: who.name }} components={{ b: <span className="font-semibold" /> }} />
          ) : (
            t("welcome.p3")
          )}
        </p>
        <p>
          <Tx ns={WORDS} k="welcome.p4" components={{ about: <Link to="/about" className={inkLink} /> }} />
        </p>
      </div>

      <ul className="mt-7 space-y-2 rounded-2xl bg-ink/4 p-4 text-[14px] text-ink/85">
        <li>
          <span aria-hidden="true">🕷️</span> {t("welcome.fact.mite")}
        </li>
        <li>
          <span aria-hidden="true">🌾</span> {t("welcome.fact.landscape")}
        </li>
        <li>
          <span aria-hidden="true">🌼</span> {t("welcome.fact.lawn")}
        </li>
        <li>
          <Art id="bee" size={17} rotate={-20} className="-mt-0.5 inline-block align-middle" /> {t("welcome.fact.wild")}
        </li>
      </ul>

      <div className="mt-8 space-y-5 text-[15px] text-ink/90">
        <h2 className="text-lg font-semibold text-ink">📉 {t("welcome.crisis.title")}</h2>

        <p>{t("welcome.crisis.p1")}</p>
        <p>
          <Tx ns={WORDS} k="welcome.crisis.p2" components={{ i: <em /> }} />
        </p>
        <p>{t("welcome.crisis.p3")}</p>

        <LossChart />

        <h2 className="pt-2 text-lg font-semibold text-ink">🏡 {t("welcome.lawns.title")}</h2>

        <p>{t("welcome.lawns.p1")}</p>
        <p>{t("welcome.lawns.p2")}</p>

        <h2 className="flex items-center gap-2 pt-2 text-lg font-semibold text-ink"><Art id="bee" size={20} rotate={-20} /> {t("welcome.wild.title")}</h2>

        <p>{t("welcome.wild.p1")}</p>

        <p>
          <Tx
            ns={WORDS}
            k="welcome.wild.p2"
            components={{
              who: who?.website ? (
                <a href={who.website} target="_blank" rel="noreferrer" className={inkLink}>
                  {who.name}
                </a>
              ) : (
                <span className="font-semibold">{who?.name ?? t("welcome.wild.unnamed")}</span>
              ),
            }}
          />
        </p>

        <WildVsManaged />

        <h2 className="pt-2 text-lg font-semibold text-ink">🧾 {t("welcome.money.title")}</h2>

        <p>{t("welcome.money.p1")}</p>
      </div>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          to="/play"
          className="rounded-full bg-[var(--color-wax)] px-5 py-2.5 text-sm font-medium text-black"
        >
          {t("welcome.practice")}
        </Link>
        <Link
          to="/ledger"
          className="rounded-full bg-ink/7 px-5 py-2.5 text-sm font-medium text-ink/90"
        >
          {t("welcome.ledger")}
        </Link>
      </div>

      <p className="mt-6 text-xs text-ink/65">{t("welcome.footnote")}</p>
    </div>
  );
}
