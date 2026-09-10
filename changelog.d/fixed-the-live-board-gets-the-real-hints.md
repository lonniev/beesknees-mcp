- **The live board now gives the same hints the practice board does.** It had a
  two-way ternary — one sentence before you aimed, one after — for an entire
  round: "Tap where you want to end up." and "Press to move." Neither says which
  of the things on screen to tap, or what the bee is trying to do. So the board
  that costs sats was the one helping least, and the newcomer who had just come
  from Practice lost the guidance at the moment it started mattering.

  `SoloBoard` had the phase-aware version all along — the one that names a
  flower with pollen and shows the mark for it, names a door and shows one, and
  says what the next press costs. That is now `game/nextStep.ts`, pure and read
  by both boards through one component.

- The regression was two implementations rather than a bad string, so the guard
  is on that: `nextStep.test.ts` asserts both boards render the shared hint and
  that neither carries its own. Proven by putting the old ternary back — one
  failure, naming the file.
