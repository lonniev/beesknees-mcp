/**
 * Native bee species against managed ones.
 *
 * Deliberately NOT a chart. The ratio is roughly 4,000 to 1, and every chart
 * form that could carry it lies: a bar for "1" is a hairline or a rounding
 * error, a pie is a full circle with an invisible slice, and a dot field at any
 * honest scale is a wall of dots. When one number dwarfs the other by three
 * orders of magnitude, the number IS the graphic — the point is the disparity,
 * and type carries a disparity better than geometry does.
 *
 * The dots below are decoration at a stated scale, not a measurement, and the
 * label says so rather than letting anyone count them.
 */

const DOTS = 60;

export default function WildVsManaged() {
  return (
    <figure className="my-7 rounded-2xl bg-white/5 p-5">
      <figcaption className="text-sm font-medium text-white/85">
        Which bees actually need the help
      </figcaption>

      <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <div className="text-4xl font-semibold tracking-tight text-[var(--color-wax)]">~4,000</div>
          <div className="mt-1 text-sm text-white/70">
            native bee species in North America
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            Many in documented decline. None has a keeper.
          </div>
        </div>

        <div className="hidden h-16 w-px bg-white/10 sm:block" />

        <div>
          <div className="text-4xl font-semibold tracking-tight text-white/80">1</div>
          <div className="mt-1 text-sm text-white/70">managed for honey and pollination</div>
          <div className="mt-1 text-[11px] text-white/40">
            Losses replaced each spring by splitting hives.
          </div>
        </div>
      </div>

      {/* Decoration, and labelled as such. One mark is picked out to stand for
          the managed species; the rest are not countable and are not meant to be. */}
      <div className="mt-5 flex flex-wrap gap-1" aria-hidden="true">
        {Array.from({ length: DOTS }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${
              i === 41 ? "bg-white/80" : "bg-[var(--color-wax)]/35"
            }`}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-white/30">
        Marks are illustrative, not to scale — the real ratio is about four thousand to one.
      </p>
    </figure>
  );
}
