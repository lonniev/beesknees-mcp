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
import { DriftingBees } from "../components/Meadowscape.tsx";
import { useCharity } from "../components/CharityNote.tsx";
import LossChart from "../components/LossChart.tsx";
import WildVsManaged from "../components/WildVsManaged.tsx";

export default function Welcome() {
  // The beneficiary is the operator's to choose and can change, so the page
  // reads the live one rather than carrying a name that quietly goes stale.
  const who = useCharity();

  return (
    <>
      <DriftingBees />
    <div className="mx-auto max-w-2xl px-5 py-10 leading-relaxed">
      <h1 className="text-3xl font-semibold tracking-tight">The Bee's Knees</h1>
      <div className="mt-4 space-y-4 text-[15px] text-ink/90">
        <p>
          This site offers an online worldwide game whose purpose is to entertain while raising
          money to fight the viral contamination of native bee populations in the US and UK, if
          not everywhere.
        </p>
        <p>
          Game play consists of joining a community of bees whose role in life is to pollinate
          flowers, to bring pollen to their hive, and to mate with the queen of the hive to
          propagate the community. Your drone competes against the other drones of the meadow to
          complete its mission first: to reach the queen to be her mate.
        </p>
        <p>
          Each of your moves costs a few satoshis — less than pennies. The money raised from all
          players collects in a honey pot. At the end of the game, 80% of the pot is paid to the
          current pollinator conservation society chosen for support
          {who?.name ? <>, presently <span className="font-semibold">{who.name}</span></> : null}.
          10% is awarded to the winning bee. The remainder is retained to help the Tollbooth DPYC
          community offer this gamified charitable service.
        </p>
        <p>
          Turn to the{" "}
          <Link
            to="/about"
            className="text-[var(--color-wax-ink)] underline decoration-dotted underline-offset-4"
          >
            About page
          </Link>{" "}
          to read more on game strategy and on the technology used to build the game. But, first,
          read on to learn about why this game matters.
        </p>
      </div>

      <ul className="mt-7 space-y-2 rounded-2xl bg-ink/4 p-4 text-[14px] text-ink/85">
        <li>
          <span aria-hidden="true">🕷️</span> A parasitic mite and the viruses it carries
          are the largest single cause of colony death.
        </li>
        <li>
          <span aria-hidden="true">🌾</span> Simplified landscape turns a season of forage
          into a fortnight's feast and then a famine.
        </li>
        <li>
          <span aria-hidden="true">🌼</span> Dandelion and clover feed colonies when they are
          weakest — and lawn culture exists to remove them.
        </li>
        <li>
          <span aria-hidden="true">🐝</span> Honeybees are livestock. The wild bees are the
          ones with nobody to replace their losses.
        </li>
      </ul>

      <div className="mt-8 space-y-5 text-[15px] text-ink/90">
        <h2 className="text-lg font-semibold text-ink">📉 The Current Pollinator Crisis</h2>

        <p>
          Beekeepers in the United States have been losing a large share of their colonies every
          year for the better part of two decades. National surveys put the annual figure between
          roughly 29 and 51 percent depending on the year, averaging near 40. British beekeepers
          report overwinter losses too, typically smaller but still far above what was once normal.
        </p>

        <p>
          The largest single cause is not mysterious. It is a parasitic mite,{" "}
          <em>Varroa destructor</em>, which reached the United States in the late 1980s and is now
          effectively everywhere. It feeds on developing bees and carries viruses — deformed wing
          virus above all — that a healthy colony would otherwise shrug off. A hive that fails in
          February usually failed because of what the mites did to it in September.
        </p>

        <p>
          The second cause is food. A bee needs varied pollen across a whole season, and a great
          deal of landscape has been simplified into single crops, mown verges and tidy turf. A
          thousand acres of one flowering crop is a fortnight's feast and then a famine.
        </p>

        <LossChart />

        <h2 className="pt-2 text-lg font-semibold text-ink">🏡 Suburban Lawns and Spring Forage</h2>

        <p>
          Dandelion and white clover are among the first reliable sources of nectar and pollen in
          spring — available exactly when colonies come out of winter at their weakest and have
          brood to feed. They are also the two plants suburban lawn culture is most determined to
          eliminate.
        </p>

        <p>
          Home and garden pesticides are applied to lawns at concentrations that frequently exceed
          agricultural rates for the same active ingredients, by people under no obligation to
          follow a label the way a licensed applicator is. As housing spreads into farmland, mixed
          forage becomes turf, and turf gets sprayed. The remedy is available to any homeowner:
          leave the dandelions, skip the broadleaf spray, let the clover be.
        </p>

        <h2 className="pt-2 text-lg font-semibold text-ink">🐝 Wild Bees most at Risk</h2>

        <p>
          Honeybees are livestock. They are not an endangered species — colony numbers hold up
          because beekeepers split hives to replace what dies. The bees in real trouble are the wild
          ones: North America has some four thousand native bee species, many in documented decline,
          and not one of them has a keeper to make up the losses.
        </p>

        <p>
          Which is why the beneficiary matters and is named rather than implied. It is{" "}
          {who?.website ? (
            <a
              href={who.website}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-wax-ink)] underline decoration-dotted underline-offset-4"
            >
              {who.name}
            </a>
          ) : (
            <span className="font-semibold">{who?.name ?? "chosen by the operator"}</span>
          )}{" "}
          — read what they do and judge the choice for yourself. Every settled round records the
          beneficiary it actually paid, so changing it never rewrites what came before.
        </p>

        <WildVsManaged />

        <h2 className="pt-2 text-lg font-semibold text-ink">🧾 Where the Money Goes</h2>

        <p>
          You buy a drone a seat, and every motion he makes costs a little. Eighty percent of
          what a round collects is owed to the charity, the winner takes a tenth, and a tenth keeps
          the service running. Every settled match is recorded with what it raised, and every
          payment to the charity is recorded with its transaction id — so you can check where it
          went rather than take anyone's word for it.
        </p>
      </div>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          to="/play"
          className="rounded-full bg-[var(--color-wax)] px-5 py-2.5 text-sm font-medium text-black"
        >
          Try a practice hive
        </Link>
        <Link
          to="/ledger"
          className="rounded-full bg-ink/7 px-5 py-2.5 text-sm font-medium text-ink/90"
        >
          Where the money went
        </Link>
      </div>

      <p className="mt-6 text-xs text-ink/65">
        The practice hive costs nothing and pays nothing — it fills the other seats with bots so you
        can learn the board before a real match.
      </p>
    </div>
    </>
  );
}
