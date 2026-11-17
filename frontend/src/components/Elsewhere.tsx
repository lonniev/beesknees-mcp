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
import HoneyChiclet from "./HoneyChiclet";
import { useT } from "../i18n/index.ts";

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
  const t = useT();

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {/* The real thing, first: the one card that leads somewhere on this site. */}
      <HoneyChiclet />
      {charity && (
        <Card
          href={charity.website || "#"}
          glyph="💛"
          title={charity.name}
          blurb={t("elsewhere.charity")}
        />
      )}
      <Card
        href="https://mcps.tollbooth-dpyc.com"
        glyph="🛰️"
        title={t("elsewhere.network")}
        blurb={t("elsewhere.networkNote")}
      />
      <Card
        href="https://goodearth.tollbooth-dpyc.com"
        glyph="🌱"
        title="Good Earth"
        blurb={t("elsewhere.goodEarthNote")}
      />
    </div>
  );
}
