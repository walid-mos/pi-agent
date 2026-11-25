/**
 * magpie-mcp: connects Pi to the MCP hub of the Magpie gateway, which serves the MCP servers of Magpie's Library that
 * this machine's gateway key may use (Jira and Confluence among them). Which servers a key sees is set in Magpie
 * (`magpie gateway-key mcp <id> ...`), not here.
 *
 * Uses the `magpie` provider configured in Pi, as decide.ts does: the address comes from models.json and the key from
 * auth.json, so neither is written in this repository. No other network call, no file read or written.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "magpie";
const SERVER = "magpie"; // tools are named mcp__magpie__<server>__<tool>
const HUB_PATH = "/mcp/magpie/hub"; // Magpie's MCP router, next to the /v1 model API

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const base = ctx.modelRegistry.getProvider(PROVIDER)?.baseUrl;
		if (!base) throw new Error(`magpie-mcp: provider "${PROVIDER}" has no baseUrl in models.json`);
		const key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
		if (!key) throw new Error(`magpie-mcp: provider "${PROVIDER}" has no key in auth.json`);

		pi.registerMcpServer(SERVER, {
			url: new URL(HUB_PATH, base).href,
			headers: { Authorization: `Bearer ${key}` },
			description:
				"Magpie's MCP hub: Jira tickets and Confluence pages (tools jira__*), and any other server this machine's " +
				"gateway key may use.",
			exposure: "deferred",
		});
	});
}
