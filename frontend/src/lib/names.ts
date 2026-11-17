/**
 * The hives and their queens, by name, in the language on screen.
 *
 * Every queen is a flower and every hive a forage plant: "Queen Rose of Hive
 * Linden". The order is `game/match.ts`'s HIVE_NAMES and QUEEN_NAMES, which
 * stay English because the match keeps them as data; these are what a reader
 * sees.
 */

import { tr, type MessageKey } from "../i18n/index.ts";

const HIVES = 5;

/** A hive's name: "Linden". */
export function hiveName(hive: number): string {
  return tr(`names.hive.${((hive % HIVES) + HIVES) % HIVES}` as MessageKey);
}

/** A queen's own name: "Rose". */
function queenOwnName(hive: number): string {
  return tr(`names.queen.${((hive % HIVES) + HIVES) % HIVES}` as MessageKey);
}

/** "Queen Rose". */
export function queenTitle(hive: number): string {
  return tr("names.queenTitle", { queen: queenOwnName(hive) });
}

/** "Queen Rose of Hive Linden". */
export function queenOf(hive: number): string {
  return tr("names.queenOf", { queen: queenOwnName(hive), hive: hiveName(hive) });
}
