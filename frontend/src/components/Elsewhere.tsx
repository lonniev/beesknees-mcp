/**
 * Where else to go, for somebody with a minute to spare.
 *
 * A lobby is the one screen where a visitor has nothing to do and is certain to
 * read something. Three cards: who the money is for, the rest of the network,
 * and the sibling service a grower would actually use.
 *
 * The charity card only appears once an operator has named one. An empty card
 * saying "our charity" would be a claim about where money goes made by a page
 * that does not know — see `CharityNote`, which takes the same line.
 */

import { ExternalLink } from "lucide-react";
import { useCharity } from "./CharityNote";

function Card({
  href,
  title,
  blurb,
  glyph,
}: {
  href: string;
  title: string;
  blurb: string;
  glyph: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex flex-1 items-start gap-3 rounded-xl border border-ink/14 p-3 text-left transition hover:border-ink/32 hover:bg-ink/4"
    >
      <span className="select-none text-lg leading-none" aria-hidden="true">
        {glyph}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[13px] font-medium text-ink/95">
          {title}
          <ExternalLink size={11} className="text-ink/65 group-hover:text-ink/78" />
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink/70">{blurb}</span>
      </span>
    </a>
  );
}

export default function Elsewhere() {
  const charity = useCharity();

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {charity && (
        <Card
          href={charity.website || "#"}
          glyph="💛"
          title={charity.name}
          blurb="Where eighty percent of every pot goes. Go and read what they do with it."
        />
      )}
      <Card
        href="https://mcps.tollbooth-dpyc.com"
        glyph="🛰️"
        title="The DPYC network"
        blurb="Every service on the tollbooth: what they do and what they charge."
      />
      <Card
        href="https://goodearth.tollbooth-dpyc.com"
        glyph="🌱"
        title="Good Earth"
        blurb="Climate answers for the ground you actually farm — the growers' MCP."
      />
    </div>
  );
}
