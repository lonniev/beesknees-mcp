/**
 * What happens to your share if you win — decided before the round.
 *
 * Asking in the moment is asking somebody to make a decision about money with
 * a trophy on the screen, so the choice lives here instead and the settlement
 * just honours it. Donating is the default, and silence counts as donating:
 * this game exists to fund pollinators, and a winner who never opened this
 * panel should still end the round with their share settled rather than owed.
 *
 * Keeping it needs somewhere to send it. If the player already published a
 * Lightning address on their Nostr profile, that address is offered rather than
 * asked for again — they have told the world once already.
 */

import { useEffect, useState } from "react";
import { ExternalLink, HeartHandshake, Loader2 } from "lucide-react";
import { payout, setPayout } from "../lib/mcp";
import { useCharity } from "./CharityNote";
import { fetchProfile } from "../lib/nostrProfile";

const field =
  "w-full rounded-lg border border-ink/25 bg-white/70 px-3 py-2 text-sm placeholder:text-ink/50 focus:border-amber-400 focus:outline-none";

export default function Winnings({ npub }: { npub: string }) {
  const [donate, setDonate] = useState(true);
  const [address, setAddress] = useState("");
  const [stated, setStated] = useState(false);
  const who = useCharity();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    payout()
      .then((p) => {
        if (!live) return;
        if (p?.success) {
          setDonate(p.donate);
          setAddress(p.lightning_address ?? "");
          setStated(p.set);
        }
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  // Only ever offered, never silently adopted: an address the player has not
  // seen is not an address they chose.
  useEffect(() => {
    if (donate || address) return;
    let live = true;
    fetchProfile(npub)
      .then((k) => live && k?.lud16 && setAddress(k.lud16))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [donate, address, npub]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await setPayout(donate, address.trim());
      if (!r.success) {
        setMsg({ tone: "err", text: r.error ?? "That did not save. Try again." });
        return;
      }
      setStated(true);
      setMsg({
        tone: "ok",
        text: donate
          ? `Settled. Your share goes to ${who?.name ?? "the charity"}.`
          : "Settled. Your share will be credited to you.",
      });
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const needsAddress = !donate && !address.trim();

  return (
    <section className="rounded-xl border border-ink/14 p-4">
      <div className="flex items-center gap-2">
        <HeartHandshake size={15} className="text-amber-300/80" />
        <h2 className="text-sm font-semibold text-ink/90">If you win</h2>
        {loading && <Loader2 size={13} className="animate-spin text-ink/65" />}
      </div>

      <p className="mt-1 text-xs text-ink/70">
        Ten percent of the pot goes to the winner. Say now what should happen to it.
        {!loading && !stated && " You have not said, so it goes to the charity."}
      </p>

      <div className="mt-4 space-y-2">
        <Choice
          checked={donate}
          onSelect={() => setDonate(true)}
          title={who ? `Donate it to ${who.name}` : "Donate it to the charity"}
          note={
            who?.website ? (
              <a
                href={who.website}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-amber-300/80 underline decoration-amber-300/30 underline-offset-2 hover:text-amber-200"
              >
                {who.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                <ExternalLink size={11} />
              </a>
            ) : (
              "The default, and where the other 80% already goes."
            )
          }
        />
        <Choice
          checked={!donate}
          onSelect={() => setDonate(false)}
          title="Keep it"
          note="Paid to a Lightning address you name."
        />
      </div>

      {!donate && (
        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-ink/65">Lightning address</label>
          <input
            className={field}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@wallet.com"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || loading || needsAddress}
        className="mt-4 w-full rounded-lg bg-[var(--color-you)] py-2 text-sm font-semibold text-black disabled:opacity-40"
      >
        {saving ? "Saving…" : needsAddress ? "An address is needed to keep it" : "Save"}
      </button>

      {msg && (
        <p className={`mt-3 text-xs ${msg.tone === "ok" ? "text-ink/78" : "text-red-300/80"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

/** A radio the size of a thumb — the whole row is the target, not the dot. */
function Choice({
  checked,
  onSelect,
  title,
  note,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  note: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
        checked ? "border-amber-400/50 bg-amber-400/5" : "border-ink/14 hover:bg-ink/4"
      }`}
    >
      <span
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-amber-400" : "border-ink/32"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-amber-400" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink/95">{title}</span>
        <span className="mt-0.5 block text-[11px] text-ink/65">{note}</span>
      </span>
    </button>
  );
}
