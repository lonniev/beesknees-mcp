/**
 * The guest welcome — why this game exists.
 *
 * Written to be checkable. Every claim here is one a reader could look up and
 * find, and where the science is qualified the sentence is qualified too. The
 * page argues for the charity by being accurate about which bees are actually
 * in trouble, which is a stronger case than the one most bee campaigns make.
 */

import { Link } from "react-router-dom";

export default function Welcome() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 leading-relaxed">
      <h1 className="text-3xl font-semibold tracking-tight">The Bee's Knees</h1>
      <p className="mt-2 text-white/60">
        A race to the queen. Most of what a round collects goes to pollinator conservation.
      </p>

      <div className="mt-8 space-y-5 text-[15px] text-white/80">
        <h2 className="text-lg font-semibold text-white">What's actually happening to bees</h2>

        <p>
          Beekeepers in the United States have been losing a large share of their colonies every
          year for the better part of two decades — commonly reported in the range of 40 to 50
          percent annually, with some winters considerably worse. British beekeepers report
          overwinter losses too, typically smaller but still far above what was once normal.
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

        <h2 className="pt-2 text-lg font-semibold text-white">The part nobody puts on a poster</h2>

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
          forage becomes turf, and turf gets sprayed. It is a quieter story than most, and it is one
          where the remedy is genuinely available to the person reading this: leave the dandelions,
          skip the broadleaf spray, let the clover be.
        </p>

        <h2 className="pt-2 text-lg font-semibold text-white">And an honest correction</h2>

        <p>
          Honeybees are livestock. They are not an endangered species — colony numbers hold up
          because beekeepers split hives to replace what dies. The bees in real trouble are the wild
          ones: North America has some four thousand native bee species, many in documented decline,
          and not one of them has a keeper to make up the losses.
        </p>

        <p>
          Which is why the money from this game goes to{" "}
          <a
            href="https://www.pollinator.org/"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-wax)] underline decoration-dotted underline-offset-4"
          >
            Pollinator Partnership
          </a>{" "}
          rather than to a honeybee charity. The hive is the game. The wild bees are the point.
        </p>

        <h2 className="pt-2 text-lg font-semibold text-white">How the money moves</h2>

        <p>
          You buy a worker bee a seat, and every motion it makes costs a little. Most of what a
          round collects is owed to the charity, the winner takes a small share, and the operator
          takes a small share. Every settled match is recorded with what it raised, and every
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
          className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-white/80"
        >
          Where the money went
        </Link>
      </div>

      <p className="mt-6 text-xs text-white/35">
        The practice hive costs nothing and pays nothing — it fills the other seats with bots so you
        can learn the board before a real match.
      </p>
    </div>
  );
}
