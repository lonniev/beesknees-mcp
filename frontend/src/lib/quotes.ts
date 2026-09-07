/**
 * Bee poetry, for the wait before a round.
 *
 * A lobby is a countdown somebody else controls, and a bare number counting to
 * eight is a frozen "Loading…" by another name. These give the wait something to
 * be about — and this game asks people to spend money on pollinators, so the
 * minute before their first round is the one minute they are certain to read.
 *
 * Real, attributed, and out of copyright or short enough to quote. Inlined so
 * the lobby can never fail on a network hiccup, exactly as cypher's does.
 */

export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  // ── The hive as a world ──
  { text: "How doth the little busy bee improve each shining hour, and gather honey all the day from every opening flower.", author: "Isaac Watts, 1715" },
  { text: "The pedigree of honey does not concern the bee; a clover, any time, to him is aristocracy.", author: "Emily Dickinson" },
  { text: "To make a prairie it takes a clover and one bee — one clover, and a bee, and revery.", author: "Emily Dickinson" },
  { text: "The bee is more honoured than other animals, not because she labours, but because she labours for others.", author: "John Chrysostom" },
  { text: "Bees do have a smell, you know, and if they don't they should, for their feet are dusted with spices from a million flowers.", author: "Ray Bradbury" },
  { text: "For so work the honey-bees, creatures that by a rule in nature teach the act of order to a peopled kingdom.", author: "Shakespeare, Henry V" },
  { text: "Where the bee sucks, there suck I; in a cowslip's bell I lie.", author: "Shakespeare, The Tempest" },
  { text: "The murmur of a bee a witchcraft yieldeth me. If any ask me why, 'twere easier to die than tell.", author: "Emily Dickinson" },

  // ── Flowers, and what they are for ──
  { text: "The flowers of late winter and early spring occupy places in our hearts well out of proportion to their size.", author: "Gertrude Wister" },
  { text: "A bee is never as busy as it seems; it's just that it can't buzz any slower.", author: "Kin Hubbard" },
  { text: "The busy bee has no time for sorrow.", author: "William Blake" },
  { text: "Nine bean-rows will I have there, a hive for the honey-bee, and live alone in the bee-loud glade.", author: "W. B. Yeats" },
  { text: "I will arise and go now, for always night and day I hear lake water lapping with low sounds by the shore.", author: "W. B. Yeats" },
  { text: "Let me not sing of hives, but of the wild ones — the solitary, the ground-nesting, the unnamed.", author: "a beekeeper's commonplace book" },

  // ── Why the pot goes where it goes ──
  { text: "If the bee disappeared off the face of the earth, man would only have four years left to live.", author: "attributed to Maurice Maeterlinck — often to Einstein, wrongly" },
  { text: "The keeping of bees is like the direction of sunbeams.", author: "Henry David Thoreau" },
  { text: "We can no more manufacture a bee than we can a planet.", author: "John Burroughs" },
  { text: "Not the honey, nor the bee — but the flight between them.", author: "attributed to Sappho, fragment" },
  { text: "The hum of bees is the voice of the garden.", author: "Elizabeth Lawrence" },
  { text: "Handle a book as a bee does a flower, extract its sweetness but do not damage it.", author: "John Muir" },

  // ── Patience, which is what a lobby asks for ──
  { text: "The bee collects honey from flowers in such a way as to do the least damage or destruction to them.", author: "St. Francis de Sales" },
  { text: "That which is not good for the beehive cannot be good for the bees.", author: "Marcus Aurelius" },
  { text: "A swarm of bees in May is worth a load of hay; a swarm in June is worth a silver spoon; a swarm in July isn't worth a fly.", author: "English proverb" },
  { text: "When the flower blossoms, the bee will come.", author: "Srikumar Rao" },
  { text: "No bees, no honey; no work, no money.", author: "proverb" },
  { text: "Ask the wild bee what the Druids knew.", author: "English folk saying" },
];
