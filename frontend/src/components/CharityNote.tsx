/**
 * Who the 80% actually goes to, with somewhere to go and check them.
 *
 * The claim is on every screen that asks for money; the name behind it was on
 * none of them. A beneficiary a player cannot look up is a beneficiary they are
 * being asked to take on trust, and this game's whole pitch is that they should
 * not have to — `charity` is free precisely so this can render anywhere.
 *
 * Renders nothing until the operator has named somebody. A placeholder here
 * would be a claim about where money goes, invented by the page.
 */

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { charity, type Charity } from "../lib/mcp";

/** The named charity, or null while unknown. Shared by every screen that says so. */
export function useCharity(): Charity | null {
  const [who, setWho] = useState<Charity | null>(null);
  useEffect(() => {
    let alive = true;
    charity()
      .then((c) => alive && c?.named && setWho(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return who;
}

export default function CharityNote({ className = "" }: { className?: string }) {
  const who = useCharity();
  if (!who) return null;

  return (
    <p className={`text-xs leading-relaxed text-ink/65 ${className}`}>
      80% of every pot goes to <span className="text-ink/80">{who.name}</span>
      {who.website && (
        <>
          {" — "}
          <a
            href={who.website}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-amber-300/80 underline decoration-amber-300/30 underline-offset-2 hover:text-amber-200"
          >
            {who.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            <ExternalLink size={11} />
          </a>
        </>
      )}
      .
    </p>
  );
}
