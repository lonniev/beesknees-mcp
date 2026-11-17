// The "Live tutorial" switch on the profile: on, every page offers its tour
// once; off, nothing pops up anywhere. Its mechanics are the package's.

import { useTourSwitch } from "@tollbooth-dpyc/web/react";
import { tour } from "../lib/tour.ts";
import { useT } from "../i18n/index.ts";

export default function TutorialSwitch() {
  const tutorial = useTourSwitch();
  const t = useT();
  return (
    <section className="rounded-xl border border-ink/14 bg-[var(--color-sky)] p-4" {...tour("account.tutorial")}>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={tutorial.on}
          onChange={(e) => tutorial.setOn(e.target.checked)}
          className="h-5 w-5 accent-[var(--color-you)]"
        />
        <span className="text-sm">
          {t("tutorial.title")}
          <span className="block text-xs leading-snug text-ink/65">
            {t("tutorial.note")}
          </span>
        </span>
      </label>
    </section>
  );
}
