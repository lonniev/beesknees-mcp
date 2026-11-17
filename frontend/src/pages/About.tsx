/**
 * What this service is, and what it is doing right now.
 *
 * Figures come from the operator's own `service_status`, so this page reports
 * the running deployment rather than what the repository claims about it.
 *
 * Every word here that is jargon carries its own definition on a dotted
 * underline (see `lib/glossary`). The page has to say MCP, Nostr, satoshi and
 * serverless to be truthful, and each of them is a wall to somebody who came
 * for a game about bees.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { annotate } from "../lib/glossary.tsx";
import {
  BeeMark, Crawl, DoorMark, Fly, Mound, PluckedFlower, PollenFlower, QueenMark, YouMark,
} from "../components/Marks.tsx";
import { BuildInfoPanel } from "@tollbooth-dpyc/web/react";
import { LINK } from "../lib/ink";
import { serviceStatus, type ServiceStatus } from "@tollbooth-dpyc/web";
import { Tx } from "@tollbooth-dpyc/web/react";
import { useT, WORDS, type MessageKey } from "../i18n/index.ts";

/** One paragraph, with the jargon in it explained. */
function P({ text, seen, className = "" }: { text: string; seen: Set<string>; className?: string }) {
  return <p className={`text-[15px] text-ink/90 ${className}`}>{annotate(text, seen)}</p>;
}

/** How many of each list the catalog holds: `about.proof.<n>.title|body`, `about.tech.<n>.title|body`. */
const PROOF = 6;
const TECH = 7;

export default function About() {
  // `null` until the hive answers; the panel reads "—" until then.
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const t = useT();
  // One page, one pass: a term is marked the first time it appears and left
  // alone after that. Six dotted underlines of "MCP" reads as spam.
  const seen = new Set<string>();

  useEffect(() => {
    let alive = true;
    serviceStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">{t("about.title")}</h1>

      <P
        seen={seen}
        className="mt-4"
        text={t("about.intro1")}
      />
      <p className="mt-2 text-[15px]">
        <Link to="/prices" className={LINK}>
          {t("about.fares")}
        </Link>
      </p>

      <P
        seen={seen}
        className="mt-4"
        text={t("about.intro2")}
      />

      <p className="mt-4 text-[13px] text-ink/65">
        {t("about.underlined")}
      </p>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">{t("about.played.title")}</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        <Tx
          ns={WORDS}
          k="about.played.p1"
          components={{ bee: <BeeMark />, pollen: <PollenFlower />, door: <DoorMark />, queen: <QueenMark /> }}
        />
      </p>

      <p className="mt-3 text-[15px] text-ink/90">
        {annotate(t("about.played.p2"), seen)}{" "}
        <span className="whitespace-nowrap">
          <Tx ns={WORDS} k="about.played.legend" components={{ pollen: <PollenFlower />, plucked: <PluckedFlower /> }} />
        </span>
      </p>

      <p className="mt-3 text-[15px] text-ink/90">
        <Tx ns={WORDS} k="about.played.p3" components={{ you: <YouMark />, bee: <BeeMark /> }} />
      </p>

      <h3 className="mt-6 text-sm font-semibold text-ink/90">{t("about.choosing.title")}</h3>
      <p className="mt-2 text-[15px] text-ink/90">
        <Tx ns={WORDS} k="about.choosing.p1" components={{ b: <b /> }} />
      </p>
      <p className="mt-3 text-[15px] text-ink/90">
        {annotate(t("about.choosing.p2"), seen)}
      </p>

      <h3 className="mt-6 text-sm font-semibold text-ink/90">{t("about.three.title")}</h3>
      <dl className="mt-2 space-y-2 text-[15px]">
        <div>
          <dt className="inline font-semibold text-ink/90">
            <Fly /> {t("about.three.fly")}
          </dt>
          <dd className="inline text-ink/85">
            {" "}
            {t("about.three.flyWhat")}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink/90">
            <Crawl /> {t("about.three.crawl")}
          </dt>
          <dd className="inline text-ink/85">
            {" "}
            {t("about.three.crawlWhat")}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink/90">
            <Mound /> {t("about.three.mound")}
          </dt>
          <dd className="inline text-ink/85">
            {" "}
            {t("about.three.moundWhat")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[13px] text-ink/70">
        {t("about.three.button")}
      </p>

      <p className="mt-4 text-[15px] text-ink/90">
        {annotate(t("about.rules"), seen)}
      </p>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">{t("about.proof.title")}</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        {t("about.proof.intro")}
      </p>
      <dl className="mt-4 space-y-4">
        {Array.from({ length: PROOF }, (_, i) => (
          <div key={i}>
            <dt className="text-[15px] font-semibold text-ink/90">{t(`about.proof.${i}.title` as MessageKey)}</dt>
            <dd className="mt-1 text-[15px] text-ink/78">{annotate(t(`about.proof.${i}.body` as MessageKey), seen)}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">{t("about.raises.title")}</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        {t("about.raises.p1")}
      </p>
      <p className="mt-3 text-[15px] text-ink/90">
        {t("about.raises.p2")}
      </p>
      <p className="mt-3 text-[15px] text-ink/90">
        {t("about.raises.p3")}
      </p>

      <h2 className="mt-9 text-lg font-semibold tracking-tight">{t("about.tech.title")}</h2>
      <p className="mt-3 text-[15px] text-ink/90">
        {t("about.tech.intro")}
      </p>
      <dl className="mt-4 space-y-4">
        {Array.from({ length: TECH }, (_, i) => (
          <div key={i}>
            <dt className="text-[15px] font-semibold text-ink/90">{t(`about.tech.${i}.title` as MessageKey)}</dt>
            <dd className="mt-1 text-[15px] text-ink/78">{annotate(t(`about.tech.${i}.body` as MessageKey), seen)}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-7 text-sm font-semibold text-ink/90">{t("about.deployment.title")}</h3>
      <p className="mt-1 text-[13px] text-ink/65">
        {t("about.deployment.note")}
      </p>
      <BuildInfoPanel
        status={status}
        heading={null}
        frontend={{ version: __APP_VERSION__, source: "https://github.com/lonniev/beesknees-mcp" }}
        classNames={{
          root: "mt-3 divide-y divide-ink/10 rounded-xl bg-ink/4 text-sm",
          section: "px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/65",
          row: "flex justify-between gap-4 px-4 py-2.5",
          label: "shrink-0 text-ink/70",
          value: "min-w-0 break-words text-right font-mono text-[12px]",
          link: LINK,
        }}
      >
        <div className="flex justify-between gap-4 px-4 py-2.5">
          <span className="shrink-0 text-ink/70">{t("about.deployment.persistence")}</span>
          <span className="font-mono text-[12px]">
            {status ? (status.vault_configured ? t("about.deployment.configured") : t("about.deployment.notConfigured")) : "—"}
          </span>
        </div>
      </BuildInfoPanel>

      <p className="mt-8 text-xs text-ink/65">
        {t("about.hives")}
      </p>
    </div>
  );
}
