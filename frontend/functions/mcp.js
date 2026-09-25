// Cloudflare Pages Function: /mcp → the beesknees-mcp operator on Horizon.
import { makeMcpProxy } from "@tollbooth-dpyc/web/pages-proxy";

export const onRequest = makeMcpProxy("https://beesknees-mcp.fastmcp.app/mcp");
