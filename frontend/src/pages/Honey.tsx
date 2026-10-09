/**
 * The honey locator: where to buy the real thing, near you.
 *
 * One strip — a place to type, or the browser's position with consent — then
 * the sellers on a map and in a list that share their numbers. The service does
 * the finding (four directories, merged and checked); this page only asks and
 * draws.
 *
 * The map's own element keeps a constant className and all sizing sits on the
 * frame round it: React rewrites the whole class attribute on a re-render,
 * which would strip the `leaflet-container` class Leaflet relies on to keep
 * its tiles sized. Leaflet itself is loaded in the browser only — it touches
 * `window` on import, and this app's routes are also rendered on the server
 * to prove they paint.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, LocateFixed, Phone, Search } from "lucide-react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { NpubGate, type Session } from "@tollbooth-dpyc/web/react";
import { findHoney, type HoneyAnswer } from "../lib/mcp";
import { distanceLabel, locateMe, sellerGlyph, usesMiles } from "../lib/honey";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_CREDIT = "© OpenStreetMap contributors";
/** Above the sign-in card, for somebody who arrived here first. */
const WELCOME = "Where the honey is sold, near you. Sign in to ask.";

export default function Honey({ session }: { session: Session }) {
  const [near, setNear] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<HoneyAnswer | null>(null);
  const [note, setNote] = useState("");
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const drawn = useRef<LayerGroup | null>(null);
  const miles = usesMiles(typeof navigator === "undefined" ? "" : navigator.language);

  // ── The map, once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!host.current || map.current) return;
    let alive = true;
    import("leaflet").then(({ default: L }) => {
      if (!alive || !host.current || map.current) return;
      const m = L.map(host.current, { tapTolerance: 15, zoomControl: true }).setView([30, 0], 2);
      L.tileLayer(TILES, { attribution: TILE_CREDIT, maxZoom: 19 }).addTo(m);
      drawn.current = L.layerGroup().addTo(m);
      map.current = m;
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      drawn.current = null;
    };
  }, []);

  // ── The answer, drawn ──────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    const g = drawn.current;
    const origin = answer?.success ? answer.origin : undefined;
    const found = answer?.success ? (answer.sellers ?? []) : [];
    if (!m || !g) return;
    if (!origin) {
      // A refusal leaves no stale pins behind to be read as an answer.
      g.clearLayers();
      return;
    }
    import("leaflet").then(({ default: L }) => {
      g.clearLayers();
      const you = L.latLng(origin.lat, origin.lon);
      L.circleMarker(you, { radius: 7, color: "#FAFAF3", weight: 2, fillColor: "#3f6212", fillOpacity: 1 })
        .bindTooltip("You", { direction: "top", offset: [0, -8] })
        .addTo(g);
      const points = [you];
      found.forEach((s, i) => {
        const at = L.latLng(s.lat, s.lon);
        points.push(at);
        // Leaflet positions the icon element with its own inline transform,
        // so the drop's rotation lives one element in, on the pin itself.
        L.marker(at, {
          icon: L.divIcon({
            className: "honey-marker",
            html: `<span class="honey-pin"><span>${i + 1}</span></span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 28],
          }),
          title: s.name,
        })
          .bindTooltip(s.name, { direction: "top", offset: [0, -26] })
          .addTo(g);
      });
      m.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 13 });
    });
  }, [answer]);

  // ── Asking ─────────────────────────────────────────────────────────────
  async function ask(where: string) {
    const q = where.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote("");
    try {
      setAnswer(await findHoney(q));
    } catch (e) {
      setAnswer(null);
      setNote(e instanceof Error ? e.message : "The hive did not answer.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(near);
  }

  async function onLocate() {
    setNote("");
    try {
      const at = await locateMe();
      setNear(at);
      await ask(at);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Position not shared.");
    }
  }

  // A paid question needs somebody to ask it. The gate is drawn here rather
  // than reached by redirect, so the page keeps its place and a server render
  // of it shows a door and not a blank.
  if (!session.signedIn) {
    return <NpubGate welcome={WELCOME} notice={session.notice} onLogin={() => session.refresh()} />;
  }

  const sellers = answer?.success ? (answer.sellers ?? []) : [];
  const refusal = answer && !answer.success ? answer.error : "";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <button
          type="button"
          onClick={onLocate}
          disabled={busy}
          aria-label="Use my position"
          title="Use my position"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ink/14 text-ink/78 hover:bg-ink/4 disabled:opacity-40"
        >
          <LocateFixed size={20} />
        </button>
        <input
          value={near}
          onChange={(e) => setNear(e.target.value)}
          placeholder="Town, postal code, or lat,lon"
          aria-label="Where"
          autoComplete="off"
          maxLength={120}
          className="h-11 min-w-0 flex-1 rounded-xl border border-ink/14 bg-white/60 px-3 text-[15px] text-ink placeholder:text-ink/50 focus:border-ink/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !near.trim()}
          aria-label="Find honey"
          title="Find honey"
          className="bk-act flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
        >
          <Search size={20} />
        </button>
      </form>

      {(note || refusal) && (
        <p className="text-sm text-[var(--color-wax-ink)]">{note || refusal}</p>
      )}

      <div className="relative h-[40vh] min-h-[260px] overflow-hidden rounded-xl border border-ink/14">
        {/* Sized by the frame; its own classes never change (see the header). */}
        <div ref={host} className="h-full w-full bg-[var(--color-far)]" />
        {busy && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-sky/50">
            <span className="animate-pulse text-3xl" aria-label="Searching">🐝</span>
          </div>
        )}
      </div>

      {sellers.length > 0 && (
        <ol className="flex flex-col gap-2">
          {sellers.map((s, i) => (
            <li key={`${s.name}-${i}`} className="flex items-start gap-3 rounded-xl border border-ink/14 p-3">
              <span className="honey-pin honey-pin-inline shrink-0" aria-hidden="true">
                <span>{i + 1}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-semibold text-ink/95">
                    <span aria-hidden="true">{sellerGlyph(s.kind)} </span>
                    {s.name}
                  </span>
                  <span className="text-xs text-ink/65">
                    {distanceLabel(s.distance_km, miles)} {s.bearing}
                  </span>
                </span>
                {s.address && <span className="mt-0.5 block text-sm text-ink/78">{s.address}</span>}
                <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {s.website && (
                    <a
                      href={s.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1 text-[var(--color-wax-ink)] underline decoration-dotted underline-offset-4"
                    >
                      Website <ExternalLink size={11} />
                    </a>
                  )}
                  {s.phone && (
                    <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 text-ink/78">
                      <Phone size={12} /> {s.phone}
                    </a>
                  )}
                </span>
                {s.verify.length > 0 && (
                  <span className="mt-1 block text-xs text-[var(--color-wax-ink)]">
                    Check first: {s.verify.join("; ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {answer?.success && (
        <p className="text-[11px] leading-snug text-ink/65">{(answer.attribution ?? []).join(" · ")}</p>
      )}
    </div>
  );
}
