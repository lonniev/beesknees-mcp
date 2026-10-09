/**
 * The door to the honey finder: a card in the lobby's card language.
 *
 * The game is a race for honey, and this is where the real thing is. It sits
 * with the other "somewhere to go" cards and on the Play chooser, which is the
 * one screen every visitor meets.
 */

import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";

export default function HoneyChiclet() {
  return (
    <Link
      to="/honey"
      className="group flex flex-1 items-start gap-3 rounded-xl border border-ink/14 p-3 text-left transition hover:border-ink/32 hover:bg-ink/4"
    >
      <span className="select-none text-lg leading-none" aria-hidden="true">
        🍯
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[13px] font-medium text-ink/95">
          Honey near you
          <MapPin size={11} className="text-ink/65 group-hover:text-ink/78" />
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink/70">
          Three sellers close by, each with an address and a website that answers.
        </span>
      </span>
    </Link>
  );
}
