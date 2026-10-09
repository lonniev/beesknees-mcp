/**
 * The honey finder's small, pure helpers — the words and the one permission.
 *
 * The position is the browser's to give and the person's to refuse. Nothing
 * here falls back to an address on the wire: a refusal is a refusal, and the
 * place box is still there to type into.
 */

/** Country codes whose road signs read in miles. */
const MILES = new Set(["US", "GB", "LR", "MM"]);

/** Whether this reader thinks in miles, from their locale's region. */
export function usesMiles(locale: string): boolean {
  const region = locale.split(/[-_]/)[1]?.toUpperCase() ?? "";
  return MILES.has(region);
}

/** "16 km" or "10 mi": whole numbers, one decimal only under ten. */
export function distanceLabel(km: number, miles: boolean): string {
  const n = miles ? km / 1.609344 : km;
  const text = n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString();
  return `${text} ${miles ? "mi" : "km"}`;
}

/** One mark per kind of seller, chosen so a list reads at a glance. */
export function sellerGlyph(kind: string): string {
  switch (kind) {
    case "honey":
      return "🍯";
    case "beekeeper":
      return "🐝";
    case "market":
      return "🧺";
    case "listing":
      return "🔖";
    default:
      return "🌻";
  }
}

/** The `near` the service takes, from a position. Five decimals is a metre. */
export function nearFromPosition(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * Ask the browser where we are. Resolves only on consent; otherwise throws the
 * browser's own reason, which the page shows as one line.
 */
export function locateMe(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser cannot share a position."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(nearFromPosition(p.coords.latitude, p.coords.longitude)),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? "Position not shared." : "Position not found.")),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  });
}
