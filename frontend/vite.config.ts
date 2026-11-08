import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { agentGuide } from "@tollbooth-dpyc/web/agent-guide"

/** The release version — the service's, since the site ships with it. */
const release = /^version\s*=\s*"([^"]+)"/m.exec(
  readFileSync(new URL("../pyproject.toml", import.meta.url), "utf8"),
)?.[1];

export default defineConfig({
  plugins: [
    react(), tailwindcss(),
    agentGuide({
      name: "The Bee's Knees",
      summary: "A monetized multiplayer race to the queen, and the fleet's charity game. Buy a drone a seat, fly it to a flower for pollen, carry it home through a hive door, then dig through the comb to reach the queen. The pot splits 80% to a pollinator charity, 10% to the winner and 10% to the operator, and the rounding always falls to the charity.",
      site: "https://beesknees.tollbooth-dpyc.com",
      mcpUrl: "https://beesknees.tollbooth-dpyc.com/mcp",
      toolPrefix: "beesknees",
      source: "https://github.com/lonniev/beesknees-mcp",
      registryName: "io.github.lonniev/beesknees-mcp",
      body: "../src/beesknees_mcp/llms.txt",
      links: [{ label: "Preview card", url: "https://beesknees.tollbooth-dpyc.com/og-image.jpg" }, { label: "Good Earth, the growers' MCP", url: "https://goodearth.tollbooth-dpyc.com" }],
    }),
  ],
  server: { port: 5180 },
  define: { __APP_VERSION__: JSON.stringify(release ?? "") },
});
