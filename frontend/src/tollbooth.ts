/**
 * Who this site is, told to @tollbooth-dpyc/web once, before anything renders.
 *
 * Its own module so the browser entry and the server-rendered route checks
 * configure the package the same way: the sign-in gate reads the app name from
 * here, and without it `/signin` would throw on the server. Keys stay under
 * "beesknees:", so a signed-in player, a held key or an avatar carries over.
 */

import { configureTollbooth } from "@tollbooth-dpyc/web";

configureTollbooth({
  slug: "beesknees",
  appName: "The Bee's Knees",
  mcpUrl: import.meta.env.VITE_MCP_URL as string,
});
