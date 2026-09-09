- **The prose is in the response body now.** A fetcher — a crawler, a link
  preview, an AI agent — gets one HTTP GET and runs no JavaScript, so from a
  single-page app it received `<div id="root">` and a script tag. Everything a
  program could say about this site came from the `<head>`; the whole Why
  argument, which is the reason the game exists, was invisible to every reader
  that does not hydrate.

  The fix was nearly free, because the app was already being server-rendered on
  every build. `scripts/routes.mjs` renders each route through Vite's SSR
  loader to prove the page is not blank, then discarded 29KB of good HTML.
  `scripts/prerender.mjs` stops discarding it: `/` and `/about` are written into
  the build as real pages, and `main.tsx` mounts with `createRoot`, which clears
  the container — so there is no hydration contract to honour and no mismatch to
  chase.

- **`beesknees_guide` (free) returns the agent guide through the MCP door**, so
  an agent that arrives by tool call does not have to fetch the website to find
  out where it is. Free deliberately: it is the document that says what
  everything else costs, and a price on it is a toll on the price list.

- **`llms.txt` exists once.** It moved from `frontend/public/` into the Python
  package, where it has to be anyway to ship inside the wheel, and the frontend
  build copies it into the output — so the site still serves it at the same URL
  and the two publications cannot drift into two documents.

- **`/ledger` and `/play` are deliberately NOT prerendered.** The ledger is
  money: what has been raised, and what has reached the charity. A build-time
  snapshot would serve figures that were true at deploy as though they were
  true now, which is worse than serving none. Those routes keep the SPA
  fallback and llms.txt points an agent at `beesknees_settlement_history`,
  which is free and current.

- **`/about` is served as `about.html`, not `about/index.html`.** Given a
  directory, Pages answers a bare `/about` with **308 → /about/** — and the
  sitemap, the nav and every link on the site say `/about`, so the directory
  form would have made the advertised URL a redirect to a different one.
  Measured against `wrangler pages dev`, not assumed.

- **The SPA fallback stays pointed at `/index.html`.** Pages special-cases
  exactly that path as the single-page-app fallback, applied only when no asset
  matches. Pointed at any other `.html`, the rule stops being a fallback: in the
  local Pages emulation `/* /app.html 200` answered `/`, `/about`, `/robots.txt`
  and `/llms.txt` alike with a 308, and `/* /app 200` served all four the same
  shell. Either would have handed a crawler HTML where it asked for robots.txt —
  the exact bug the robots.txt file was added to fix. A test holds the rule.
