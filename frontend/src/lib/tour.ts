// The guided tour's words and names, for this site.
//
// The mechanics — the popovers, the offer after a quiet while, who sees it,
// the switch and the replay — are the package's (`@tollbooth-dpyc/web`). What
// is this site's: the `data-tour` names its controls carry, declared once
// here so a step and an element share one spelling, and what each step says
// (in the catalog, under `tour.<target>`). Short, and in the voice of someone
// showing a friend around the hive.

import { accountTour, signInTour, type Tour, type TourStep } from "@tollbooth-dpyc/web";
import { tr, type MessageKey, type Translate } from "../i18n/index.ts";

export const TARGETS = [
  // The chooser.
  "play.practice", "play.real", "play.honey", "play.signin",
  // The lobby.
  "lobby.hives", "lobby.fund", "lobby.share",
  // The board, solo or live.
  "board.hive", "board.tactics", "board.act", "board.hint", "board.rival", "board.new",
  // Honey near you.
  "honey.locate", "honey.where", "honey.find", "honey.map", "honey.sellers",
  // The profile.
  "account.balance", "account.winnings", "account.tutorial", "account.signout",
] as const;

export type Target = (typeof TARGETS)[number];

/// The attribute to spread on the element a step points at.
export function tour(id: Target): { "data-tour": Target } {
  return { "data-tour": id };
}

export const TOUR_PAGES = ["play", "lobby", "board", "honey", "signin", "account"] as const;
export type TourPage = (typeof TOUR_PAGES)[number];

/** A step on one of the hive's own pages, its words read in the language on screen. */
function step(t: Translate, target: Target, extra: Partial<TourStep> = {}): TourStep {
  const key = `tour.${target}` as const;
  return { target, title: t(`${key}.title` as MessageKey), says: t(`${key}.says` as MessageKey), ...extra };
}

/** Every tour, in the language `t` speaks: build them again when the language changes. */
export function tours(t: Translate = tr): Record<TourPage, Tour> {
  return {
    play: { page: "play", steps: [
      step(t, "play.practice"),
      step(t, "play.real"),
      step(t, "play.honey"),
      step(t, "play.signin"),
    ]},

    lobby: { page: "lobby", steps: [
      step(t, "lobby.hives", { side: "bottom" }),
      step(t, "lobby.fund"),
      step(t, "lobby.share"),
    ]},

    board: { page: "board", steps: [
      step(t, "board.hive", { side: "top" }),
      step(t, "board.tactics", { side: "top" }),
      step(t, "board.act", { side: "top" }),
      step(t, "board.hint", { side: "top" }),
      step(t, "board.rival", { side: "top" }),
      step(t, "board.new", { side: "bottom", align: "end" }),
    ]},

    honey: { page: "honey", steps: [
      step(t, "honey.where"),
      step(t, "honey.locate"),
      step(t, "honey.find"),
      step(t, "honey.map", { side: "top" }),
      step(t, "honey.sellers", { side: "top" }),
    ]},

    signin: signInTour("signin"),

    account: accountTour("account", [
      step(t, "account.tutorial", { side: "top" }),
      step(t, "account.signout", { side: "top" }),
      step(t, "account.balance", { side: "top" }),
      step(t, "account.winnings", { side: "top" }),
    ]),
  };
}
