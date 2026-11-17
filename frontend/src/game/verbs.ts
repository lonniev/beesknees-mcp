/**
 * The verbs, and what the button says — one set of words for both boards.
 *
 * Solo and live each carried their own copy of the tactic strip and their own
 * way of naming the wait, and the two drifted within a day of the second one
 * existing. They import this now; `verbs.test.ts` holds the words still.
 *
 * Two modes, not three — and only one of them is a decision.
 *
 * Fly and Dig were separate buttons the player had to choose BETWEEN before
 * tapping, which made them a mode error waiting to happen: whether a step is a
 * crawl or a cut is decided by the cell, not by the person, and with "Fly"
 * selected the diggable cells were not offered at all, so a perfectly good
 * comb face read as a dead end. Moving is now one verb that names itself from
 * the cell it is about to enter — a bee in the meadow flies, a bee in a tunnel
 * crawls, because "Fly" over a bee that is underground reads as a bug rather
 * than as a synonym.
 *
 * Seal stays its own mode because it genuinely is one: it is the only thing
 * here that destroys rather than travels, and it must never be a mis-tap.
 *
 * Pure: no React, no DOM, so it runs under `node --test`. The icon is a mark
 * id from `art/shapes.ts` — the button draws it. The words are read from the
 * catalog in the language on screen; `word` stays the English token "Fly" or
 * "Crawl", which is how the two boards name the move between themselves.
 */

import type { SymbolId } from "../art/shapes.ts";
import { tr } from "../i18n/index.ts";

export type Verb = "move" | "seal";

export const VERBS: readonly Verb[] = ["move", "seal"];

/** What a tactic is for, under the pointer. */
export function verbHint(id: Verb): string {
  return id === "move" ? tr("verbs.moveHint") : tr("verbs.sealHint");
}

/**
 * The motion's name, decided by where it ENDS rather than where it starts.
 *
 * A bee on the square outside a door is about to go underground, so it crawls
 * in — even though it is standing in open air. A bee in the doorway heading
 * back out is about to be airborne, so it flies out. Naming the word after the
 * bee's current cell got both of those backwards, which is exactly the moment
 * the word matters: at the threshold.
 */
export function moveWord(destInHive: boolean): string {
  return destInHive ? "Crawl" : "Fly";
}

/** Wings above ground, feet below. A bee going into a tunnel is not flying. */
export function verbIcon(id: Verb, word: string): SymbolId {
  if (id === "move") return word === "Crawl" ? "crawl" : "go";
  return "fill";
}

/** The tactic's name in teeny print under its icon: the move by the word it is called out there, the seal by the owner's word for it. */
export function tacticLabel(id: Verb, word: string): string {
  if (id !== "move") return tr("verbs.tactic.mound");
  return word === "Crawl" ? tr("verbs.tactic.crawl") : tr("verbs.tactic.fly");
}

/** The verb as the button's imperative. */
export function verbLabel(id: Verb, word: string): string {
  if (id !== "move") return tr("verbs.go.fill");
  return word === "Crawl" ? tr("verbs.go.crawl") : tr("verbs.go.fly");
}

/** What the button shows: a mark and a word. */
export interface ActionLabel {
  icon: SymbolId | null;
  text: string;
}

/** Ready: say what pressing will do. */
export function readyLabel(id: Verb, word: string): ActionLabel {
  return { icon: verbIcon(id, word), text: verbLabel(id, word) };
}

/**
 * Busy: say what the bee is DOING while its clock runs down, not what to press.
 *
 * The button showed its imperative the whole time — "Dig!" greyed out for eight
 * seconds — so the one control on screen spent most of a round telling you to
 * do something you had already done. Naming the ACTIVITY makes the wait the
 * bee's work rather than the interface's silence. The verb that caused the wait
 * rides the label, so a player glancing down knows which of their choices is
 * being paid for.
 *
 * `word` is Crawl or Fly, which the caller already decides from where the step
 * ENDS — underground is a crawl whichever side of the threshold you started on.
 */
export function activityLabel(action: string | null | undefined, word: string): ActionLabel {
  // A dig is the move verb cutting its way in — feet, not the wax cap.
  if (action === "dig") return { icon: "crawl", text: tr("verbs.digging") };
  if (action === "collapse") return { icon: "fill", text: tr("verbs.sealing") };
  if (action === "fly") return word === "Crawl" ? { icon: "crawl", text: tr("verbs.crawling") } : { icon: "go", text: tr("verbs.flying") };
  return { icon: "bee", text: tr("verbs.resting") };
}

/**
 * The word for the wait in the prompt beside the button, with the seconds left.
 *
 * It said "Resting" whatever the delay was for, which told the player their bee
 * was idle at the exact moment it was working hardest — eight seconds of it,
 * after cutting a cell. The cell really does open the instant the dig is paid
 * for, and the bee really is standing in it — that is the rule, and the
 * server's fenced write depends on it. So "Digging" is an honest reading of
 * the same fact rather than a fiction: the bee is in the cell it is still busy
 * cutting its way through.
 */
export function busyWord(action: string | null | undefined, seconds: string): string {
  if (action === "dig") return tr("board.digging", { s: seconds });
  if (action === "collapse") return tr("board.sealing", { s: seconds });
  return tr("board.resting", { s: seconds });
}
