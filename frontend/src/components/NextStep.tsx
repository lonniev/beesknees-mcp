/**
 * The hint, painted. The words come from `game/nextStep`, which is pure and
 * tested; this only decides what the mark looks like.
 */
import { DoorMark, PollenFlower } from "./Marks.tsx";
import { nextStep } from "../game/nextStep.ts";

export default function NextStep(p: {
  phase: string | undefined;
  aimed: boolean;
  why: string;
  word: string;
}) {
  const { text, mark } = nextStep(p.phase, p.aimed, p.why, p.word);
  return (
    <>
      {text}
      {mark === "pollen" ? <PollenFlower /> : null}
      {mark === "door" ? <DoorMark /> : null}
    </>
  );
}
