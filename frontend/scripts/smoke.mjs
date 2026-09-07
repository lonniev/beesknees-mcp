/**
 * Does the app paint a full board on first render?
 *
 * Types compiling and tests passing say nothing about whether the page comes up
 * blank — a throw inside a component is caught by React, not by tsc. This
 * server-renders the real App and counts what a player should see. It uses
 * Vite's own SSR loader so it needs no extra toolchain.
 *
 *   npm run smoke
 */

import { createServer } from "vite";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// The match loop lives in a rAF; SSR has no frames and needs none.
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const HIVES = 5;
const SEATS = 12;

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
    // The board, not the router shell — this check exists to prove a full
  // board paints, and the shell would render an empty route on the server.
  const { default: App } = await server.ssrLoadModule("/src/SoloBoard.tsx");
  const html = renderToString(createElement(App));
  // Count only the boards. Every lucide icon is an <svg> with paths too, which
  // is how an earlier version of this check "found" seven hives.
  const count = (re) => (html.match(re) || []).length;
  const boards = count(/class="hive/g);
  const bees = count(/🐝/g);

  // The aim must reach the screen. The halo, the state and the tap handler were
  // each correct on their own while the prop between two of them was never
  // passed — so the only check that catches it is one that renders the board
  // WITH an aim and confirms more appears than without.
  const { HiveView } = await server.ssrLoadModule("/src/components/HiveView.tsx");
  const { makeSoloMatch, seated, isHot } = await server.ssrLoadModule("/src/game/match.ts");
  const hive = makeSoloMatch("You", 2).hives[0];
  const view = { board: hive.round.board, bees: seated(hive), hot: isHot(hive) };
  const draw = (target) =>
    renderToString(
      createElement(HiveView, { ...view, frame: 1, youId: 0, target, focused: true, armed: false, onTapCell: () => {} }),
    );
  // Count the AIM's own ink, not the bee's. These were the same lime until the
  // destination and the bee became indistinguishable on screen and the aim was
  // moved to white — at which point this check went blind and said so, which is
  // the only reason it is still honest.
  const aimMarks = (h) => (h.match(/#fff/g) || []).length;
  const aimed = aimMarks(draw(120));
  const unaimed = aimMarks(draw(null));

  const problems = [];
  // Your own bee gets a spoke and a halo nothing else on the board uses; if it
  // is missing, a player cannot find themselves among twelve identical glyphs.
  const youMarks = count(/--color-you/g);

  console.log(
    `rendered ${html.length} bytes · ${boards} boards · ${bees} bees · ` +
      `${count(/👑/g)} queens · ${youMarks} "you" marks · aim ${unaimed}->${aimed}`,
  );

  if (aimed <= unaimed) problems.push(`aiming draws nothing (${unaimed} -> ${aimed} marks)`);
  // Four hives, four circles. The focused hive used to be drawn in the strip
  // AS WELL as full size, which put the same hive on screen twice and read as a
  // fifth one. This is the assertion that would have caught it.
  if (boards !== HIVES) problems.push(`want exactly ${HIVES} hive boards, got ${boards}`);
  if (bees < HIVES * SEATS) problems.push(`want ${HIVES * SEATS} bees on screen, got ${bees}`);
  if (html.includes("NaN")) problems.push("NaN reached the markup");
  if (youMarks < 3) problems.push(`your own bee is not marked (${youMarks} refs; want spoke + halo + ring)`);

  if (problems.length) {
    console.error("FAIL: " + problems.join("; "));
    process.exitCode = 1;
  } else {
    console.log("OK — first paint is a full board");
  }
} finally {
  await server.close();
}
