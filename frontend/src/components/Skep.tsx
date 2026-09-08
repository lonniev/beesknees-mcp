/**
 * A skep, drawn in line.
 *
 * The paths are ported from goodearth-mcp, where the same drawing is an
 * INSTRUMENT — its bee count reads out whether it is warm enough to forage.
 * None of that travels: this app has no thermometer and the skep here is a
 * marker for a hive somebody can sit in. Carrying the mood machinery across
 * would have been carrying the other app's state along with its idea.
 *
 * `filling` is how much of the hive has taken a seat, 0 to 1. It lifts the
 * ink rather than adding anything: a hive with bees in it looks awake, and one
 * nobody has joined recedes, without a badge or a number saying so — those are
 * already underneath it.
 */

export default function Skep({
  filling = 0,
  yours = false,
  className = "",
}: {
  filling?: number;
  yours?: boolean;
  className?: string;
}) {
  const ink = yours ? "var(--color-you)" : "var(--color-wax)";
  // Never fully dark: an invisible hive reads as a rendering fault, not as an
  // empty one. Never fully bright either — this sits behind the seats.
  const alpha = 0.28 + Math.min(1, Math.max(0, filling)) * 0.45;

  return (
    <svg
      viewBox="0 0 150 120"
      className={`pointer-events-none block h-auto w-full ${className}`}
      style={{ opacity: alpha }}
      aria-hidden="true"
    >
      {/* Heavier strokes than a full-page drawing needs: at this width a
          hairline on dark ground reads as a smudge rather than a skep. */}
      <g fill="none" stroke={ink} strokeWidth="3.4" strokeLinecap="round">
        <path d="M30 100h90M38 100V108M112 100V108" />
        <path d="M45 100c-4-14-2-34 10-48s26-22 20-52" />
        <path d="M105 100c4-14 2-34-10-48S69-22 75 0" />
        <path d="M43 86h64M47 72h56M52 58h46M58 44h34M65 30h20" />
        {/* The doorway. A hive a bee could actually get into. */}
        <path d="M68 100a7 7 0 0 1 14 0" />
      </g>
    </svg>
  );
}
