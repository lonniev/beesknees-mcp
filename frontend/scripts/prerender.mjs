/**
 * Put the prose in the response body.
 *
 * A fetcher — a crawler, a link preview, an AI agent — gets one HTTP GET. It
 * runs no JavaScript, so from a single-page app it receives `<div id="root">`
 * and a script tag, and everything it can tell you about this site comes from
 * the `<head>`. The whole Why argument, which is the reason the game exists,
 * was invisible to every reader that does not hydrate.
 *
 * The fix is nearly free, because the app was ALREADY being server-rendered on
 * every build: `routes.mjs` renders each route through Vite's SSR loader to
 * prove the page is not blank, then discards 29KB of perfectly good HTML. This
 * stops discarding it.
 *
 * `main.tsx` mounts with `createRoot`, which CLEARS the container and renders
 * fresh — so there is no hydration contract to honour and no mismatch to chase.
 * The static markup is what a fetcher reads and what a human sees for one
 * frame; the live app then replaces it wholesale. That is the cheap, safe half
 * of prerendering, and the half that buys the legibility.
 *
 *   npm run prerender      (runs after `vite build`)
 */

import { createServer } from "vite";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const DIST = "dist";

/**
 * The agent guide, and why it is not in `public/`.
 *
 * `llms.txt` has two audiences that reach it two different ways: a fetcher
 * asking the website for `/llms.txt`, and an MCP client calling
 * `beesknees_guide`. Two audiences is not two documents — a copy in
 * `frontend/public/` and a copy in the Python package would drift, and the
 * first anybody would notice is an agent being told something the site no
 * longer says.
 *
 * So it lives once, in the Python package, where it has to be anyway to ship
 * inside the wheel. The build copies it into `dist/`, which is why the site
 * still serves it at exactly the same URL.
 */
const GUIDE_SRC = "../src/beesknees_mcp/llms.txt";
const GUIDE_OUT = "llms.txt";

/**
 * The PROSE routes, and a phrase that proves the prose actually landed.
 *
 * `/ledger` and `/play` are deliberately absent, and not from laziness. Both
 * are live: the ledger is money — what has been raised and what has been paid
 * to the charity — and a build-time snapshot of it would serve figures that
 * were true at deploy as though they were true now. A stale number in a money
 * UI is worse than no number, so those two keep the SPA fallback and an agent
 * is pointed at `beesknees_settlement_history`, which is free and current.
 */
const PROSE = [
  // `/` is the game chooser now. It is short, but it is what the bare domain
  // serves and what the SPA fallback answers an unknown path with, so it is
  // the first thing every fetcher reads — and an empty div is a poor greeting.
  ["/", "index.html", /Welcome to The Bee(&#x27;|')s Knees game[\s\S]*Practice[\s\S]*Real round/],
  // The pollinator argument, which used to be at `/`. Losing its URL when Play
  // took the root would have undone the whole point of prerendering: a fetcher
  // follows only links it has seen, so the argument needs a path of its own in
  // `sitemap.xml` and in `llms.txt`, not a place in the router's rotation.
  ["/why", "why.html", /online worldwide game[\s\S]*drone[\s\S]*honey pot/],
  // `about.html`, NOT `about/index.html`. Pages resolves a bare `/about` to
  // `about.html` and serves it; given a directory it answers **308 → /about/**
  // instead. The sitemap and every link on the site say `/about`, so the
  // directory form makes the advertised URL a redirect to a different one, and
  // a fetcher that does not follow redirects gets no page at all. Measured
  // against `wrangler pages dev`, not assumed.
  ["/about", "about.html", /How it is played[\s\S]*How we know it is a game[\s\S]*The technology/],
];

/// Where React mounts. Matched exactly, and its absence is fatal: if Vite ever
/// emits a different shell this script would otherwise write the template back
/// out unchanged and report success, which is the failure that looks like a pass.
const MOUNT = '<div id="root"></div>';

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { renderRoute } = await server.ssrLoadModule("/scripts/routeProbe.tsx");
  const template = readFileSync(join(DIST, "index.html"), "utf8");

  if (!template.includes(MOUNT)) {
    // Two different causes, and telling them apart saves the reader a hunt.
    // Re-running this against its own output is the ordinary one — the mount
    // is full, not missing — and refusing is right: injecting twice would
    // nest one render inside another.
    console.error(
      template.includes('<div id="root">')
        ? `FAIL — ${DIST}/index.html is already prerendered. Run \`vite build\` first.`
        : `FAIL — ${DIST}/index.html has no ${MOUNT} to fill. Did Vite change the shell?`,
    );
    process.exit(1);
  }

  // Copy before rendering: if the canonical guide has moved, say so now rather
  // than after two pages of work. `copyFileSync` throws on a missing source,
  // and an unhandled throw here fails the build — which is what should happen,
  // because a deploy that quietly stopped serving /llms.txt looks exactly like
  // a deploy that worked.
  copyFileSync(GUIDE_SRC, join(DIST, GUIDE_OUT));
  console.log(`  guide   → ${GUIDE_OUT.padEnd(16)} (from ${GUIDE_SRC})`);

  const problems = [];
  for (const [path, out, want] of PROSE) {
    let body = "";
    try {
      body = renderRoute(path);
    } catch (e) {
      problems.push(`${path} threw: ${e.message}`);
      continue;
    }
    if (!want.test(body)) {
      problems.push(`${path} rendered ${body.length} bytes without ${want}`);
      continue;
    }
    const html = template.replace(MOUNT, `<div id="root">${body}</div>`);
    const target = join(DIST, out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
    console.log(`  ${path.padEnd(7)} → ${out.padEnd(16)} (${body.length} bytes of prose)`);
  }

  if (problems.length) {
    console.error("\nFAIL\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log("OK — the prose is in the response body, not only in the bundle");
} finally {
  await server.close();
}
