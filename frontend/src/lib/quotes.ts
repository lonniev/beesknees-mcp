/**
 * Bee poetry, for the wait before a round.
 *
 * A lobby is a countdown somebody else controls, and a bare number counting to
 * eight is a frozen "Loading…" by another name. These give the wait something to
 * be about — and this game asks people to spend money on pollinators, so the
 * minute before their first round is the one minute they are certain to read.
 *
 * Real, attributed, and out of copyright or short enough to quote. Bundled so
 * the lobby can never fail on a network hiccup; another language's are its
 * translation, still attributed to the same hand. The scroller that shows them
 * is @tollbooth-dpyc/web's.
 */

import type { Quote } from "@tollbooth-dpyc/web";
import { tr, type MessageKey, type Translate } from "../i18n/index.ts";

/**
 * How many there are. The words are `quotes.<n>.text` and `quotes.<n>.author`
 * in the catalog, grouped there as they were here: the hive as a world;
 * flowers, and what they are for; why the pot goes where it goes; patience,
 * which is what a lobby asks for.
 */
export const QUOTE_COUNT = 26;

/** Every quote, in the language `t` speaks. */
export function quotes(t: Translate = tr): Quote[] {
  return Array.from({ length: QUOTE_COUNT }, (_, i) => ({
    text: t(`quotes.${i}.text` as MessageKey),
    author: t(`quotes.${i}.author` as MessageKey),
  }));
}
