/**
 * Does every route actually render something, and is the sign-in screen reachable?
 *
 * The identity components were copied in from sibling services and then sat in
 * the folder unreferenced for weeks. Nothing caught it: they compiled, the tests
 * passed, and the site served 200 on every route — because a component nothing
 * imports is not an error, it is just absent. So this walks the real router and
 * asserts each page renders, and that /signin renders the GATE rather than a
 * blank div.
 *
 *   npm run routes
 */

import { createServer } from "vite";

globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// Each page, and a phrase that only appears when that page really rendered.
// Deliberately content, not a class name: a wrapper div renders whether or not
// the thing inside it does.
const ROUTES = [
  // `/` is the chooser now — the bare domain opens on the game. Both doors
  // must be on it, and so must the sentence that says what the site is.
  //
  // The apostrophe is spelled both ways because this is SERVER-rendered
  // markup: React escapes it to `&#x27;`, so a pattern carrying a literal `'`
  // matches nothing on a page that rendered perfectly. The /signin probe below
  // hit the same wall first.
  ["/", /Welcome to The Bee(&#x27;|')s Knees game[\s\S]*Practice[\s\S]*real game/],
  // Still routed under its own name, because it is in the sitemap, in llms.txt
  // and in links already sent.
  ["/play", /Practice[\s\S]*real game/],
  // The welcome page must SAY what this is, not merely be titled. It opened
  // with "A race to the queen", which tells a first-time visitor nothing —
  // matching only the name would have let that back in without a murmur.
  ["/why", /online worldwide game[\s\S]*drone[\s\S]*honey pot/],
  ["/ledger", /Pollinator|ledger|Ledger/i],
  ["/about", /./],
  ["/signin", /Sign in to The Bee(&#x27;|')s Knees/],
  // The operator console. Server-rendered with nobody signed in, so what must
  // appear is the REFUSAL — proof that the gate is drawn before the page is.
  ["/operator", /belongs to whoever runs the hive|Asking the hive/],
  ["/profile", /not signed in/i], // signed out is the server's view of it
];

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { renderRoute } = await server.ssrLoadModule("/scripts/routeProbe.tsx");

  const problems = [];
  for (const [path, want] of ROUTES) {
    let html = "";
    try {
      html = renderRoute(path);
    } catch (e) {
      problems.push(`${path} threw: ${e.message}`);
      continue;
    }
    if (html.length < 200) problems.push(`${path} rendered ${html.length} bytes — near enough blank`);
    else if (!want.test(html)) problems.push(`${path} rendered, but without ${want}`);
    else console.log(`  ${path.padEnd(9)} ok  (${html.length} bytes)`);
  }

  if (problems.length) {
    console.error("\nFAIL\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log("OK — every route renders, and the sign-in screen is wired in");
} finally {
  await server.close();
}
