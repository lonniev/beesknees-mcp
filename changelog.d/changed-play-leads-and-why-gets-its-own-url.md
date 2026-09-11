- **`Play!` leads the bar, and `/` opens on the game.** A visitor who came to
  play had to cross three questions to reach it. The first tab and the bare
  domain are now the same door, and an unknown path lands there too.

- **The Why page moved to `/why`, and that is the load-bearing half.** It had no
  URL of its own — it was simply what `/` rendered. Letting Play take the root
  without giving it one would have deleted the pollinator argument from the
  readable web: a fetcher runs no JavaScript and follows only links it has been
  shown, so a page that exists solely as a router rotation cannot be crawled,
  cited or listed. `/why` is prerendered, in `sitemap.xml`, and named in
  `llms.txt`. `/play` is kept alongside `/` because it is in the sitemap, in the
  guide, and in links already sent.

- A probe pattern carrying a literal apostrophe matches nothing in
  server-rendered markup — React escapes it to `&#x27;` — so a page that
  rendered perfectly reads as a failure. Both route probes now spell it either
  way, and say why.
