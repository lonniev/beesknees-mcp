/**
 * Every tool, what it does and its live fare: the fleet's price sheet.
 *
 * Read from the operator's pricing model with the free `get_pricing_model`
 * call, so a visitor sees it without signing in. Reached from About, not the
 * bar: five labelled tabs and a brand already fill a phone.
 */

import { PriceSheet } from "@tollbooth-dpyc/web/react";

export default function Prices() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PriceSheet />
    </div>
  );
}
