// The guided tour's words and names, for this site.
//
// The mechanics — the popovers, the offer after a quiet while, who sees it,
// the switch and the replay — are the package's (`@tollbooth-dpyc/web`). What
// is this site's: the `data-tour` names its controls carry, declared once
// here so a step and an element share one spelling, and what each step says.
// Short, and in the voice of someone showing a friend around the hive.

import { accountTour, signInTour, type Tour } from "@tollbooth-dpyc/web";

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

export const TOURS: Record<TourPage, Tour> = {
  play: { page: "play", steps: [
    { target: "play.practice", title: "Practice",
      says: "A round against the house, free. Tap it to learn the moves at your own pace." },
    { target: "play.real", title: "The real game",
      says: "Real bees, a real pot, and 80% of it to the pollinators. It takes a key and a few sats; tap it and it says what." },
    { target: "play.honey", title: "Honey near you",
      says: "Where honey is sold close to you, with an address and a website that answers." },
    { target: "play.signin", title: "Sign in",
      says: "Have an npub already? Sign in here and the real game opens." },
  ]},

  lobby: { page: "lobby", steps: [
    { target: "lobby.hives", title: "The hives",
      says: "Five hives, twelve seats each. The race begins the moment any hive holds eight bees.", side: "bottom" },
    { target: "lobby.fund", title: "Fund a Bee",
      says: "Puts your bee in a seat. The fee joins the pot, and most of the pot goes to the pollinators." },
    { target: "lobby.share", title: "Bring a friend",
      says: "Copies a link to this race. A friend in a seat is a better game than a bot in one." },
  ]},

  board: { page: "board", steps: [
    { target: "board.hive", title: "The hive",
      says: "Your bee's three acts: reach a flower, carry the pollen back through a door, then tunnel in to the queen. Tap where you want to go.", side: "top" },
    { target: "board.tactics", title: "Tactic",
      says: "Fly travels open ground, crawl cuts fresh comb, mound buries an open cell. Cruise keeps pressing for you inside the hive.", side: "top" },
    { target: "board.act", title: "Now",
      says: "Press to make the move. The wax fills as the rest runs down; a bee moves once a second, longer after a dig.", side: "top" },
    { target: "board.hint", title: "What next",
      says: "One line that follows your bee: which flower, which door, how long the rest.", side: "top" },
    { target: "board.rival", title: "The other hives",
      says: "Tap one to watch its race. Back to my bee returns you to your own.", side: "top" },
    { target: "board.new", title: "Another round",
      says: "Starts a fresh round when this one is over.", side: "bottom", align: "end" },
  ]},

  honey: { page: "honey", steps: [
    { target: "honey.where", title: "Where",
      says: "A town, a postal code, or lat,lon. The hive looks within a hundred kilometres." },
    { target: "honey.locate", title: "Use my position",
      says: "Fills in where this device is, with your say-so." },
    { target: "honey.find", title: "Find honey",
      says: "Asks the hive for three sellers near there, each with an address and a website that answers." },
    { target: "honey.map", title: "The map",
      says: "Each seller pinned and numbered to match the list below.", side: "top" },
    { target: "honey.sellers", title: "The sellers",
      says: "Name, distance, address, website and phone. Check first marks what to confirm before you drive.", side: "top" },
  ]},

  signin: signInTour("signin"),

  account: accountTour("account", [
    { target: "account.balance", title: "Your balance",
      says: "Your Patron's tranche of api_sats pays MCP tool fees — a seat, a move. Pick an amount and pay the Lightning invoice; the page sees it arrive.", side: "top" },
    { target: "account.winnings", title: "If you win",
      says: "Where a win goes: to the charity, or to the Lightning address you save here.", side: "top" },
    { target: "account.tutorial", title: "Live tutorial",
      says: "This tour, on every page. Off here or from any popover; on to see it all again.", side: "top" },
    { target: "account.signout", title: "Sign out",
      says: "Ends this session. Your sats and your key stay yours.", side: "top" },
  ]),
};
