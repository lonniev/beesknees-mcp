import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** The release version — the service's, since the site ships with it. */
const release = /^version\s*=\s*"([^"]+)"/m.exec(
  readFileSync(new URL("../pyproject.toml", import.meta.url), "utf8"),
)?.[1];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180 },
  define: { __APP_VERSION__: JSON.stringify(release ?? "") },
});
