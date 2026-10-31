/** The hive's decoration on the shared top-up tiles: a swarm that grows with the jar. */

import type { DecorateTile } from "@tollbooth-dpyc/web/react";
import { Art } from "../art/svg.tsx";

const SWARM: Record<number, number> = { 100: 1, 500: 2, 1_000: 3, 5_000: 4, 25_000: 5 };

export const decorateTile: DecorateTile = (sats) => {
  const bees = SWARM[sats];
  if (!bees) return undefined;
  return {
    mark: (
      <span className="grid w-7 grid-cols-2 justify-items-center" aria-hidden>
        {Array.from({ length: bees }, (_, k) => (
          <Art key={k} id="bee" size={14} rotate={-20 + k * 10} />
        ))}
      </span>
    ),
  };
};
