/**
 * The router wrapper, loaded through Vite so it shares ONE react-router
 * instance with App. Importing MemoryRouter separately from Node gets a second
 * copy of the module, and a NavLink then renders outside any Router it knows
 * about. Lives in scripts/ so it never reaches the shipped bundle.
 */
import { createElement } from "react";
import { prerender } from "react-dom/static";
import { MemoryRouter } from "react-router-dom";
import "../src/tollbooth.ts";
import App from "../src/App.tsx";

/// Waits for every lazy page to arrive, so the markup is the page and never
/// the Suspense fallback that a synchronous render would stop at.
export async function renderRoute(path: string): Promise<string> {
  const { prelude } = await prerender(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)),
    // One piece: a large boundary is otherwise sent as a template and a script
    // that swaps it in, and a fetcher runs no script.
    { progressiveChunkSize: Infinity },
  );
  return new Response(prelude).text();
}
