// The "Live tutorial" switch on the profile: on, every page offers its tour
// once; off, nothing pops up anywhere. Its mechanics are the package's.

import { useTourSwitch } from "@tollbooth-dpyc/web/react";
import { tour } from "../lib/tour.ts";

export default function TutorialSwitch() {
  const tutorial = useTourSwitch();
  return (
    <section className="rounded-xl border border-ink/14 p-4" {...tour("account.tutorial")}>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={tutorial.on}
          onChange={(e) => tutorial.setOn(e.target.checked)}
          className="h-5 w-5 accent-[var(--color-you)]"
        />
        <span className="text-sm">
          Live tutorial
          <span className="block text-xs leading-snug text-ink/65">
            A short walk around each page the first time it sits quiet, pointing at what to do.
          </span>
        </span>
      </label>
    </section>
  );
}
