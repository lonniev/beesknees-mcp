/**
 * The router wrapper, loaded through Vite so it shares ONE react-router
 * instance with App. Importing MemoryRouter separately from Node gets a second
 * copy of the module, and a NavLink then renders outside any Router it knows
 * about. Lives in scripts/ so it never reaches the shipped bundle.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.tsx";

export function renderRoute(path: string): string {
  return renderToString(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)),
  );
}
