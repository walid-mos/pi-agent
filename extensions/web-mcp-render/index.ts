/**
 * Draws the calls and results of the e2e and chrome MCP servers with the functions of `format.ts`, wrapped in Pi's
 * Text. Every other tool keeps what the other resolvers give it. No logic of its own.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { formatCall, formatResult, type Result, type Theme } from "./format.ts";

const SERVERS = ["mcp__e2e__", "mcp__chrome__"];

/** The previous component of the slot, updated in place, or a new one. */
function text(content: string, context: { lastComponent?: unknown }): Text {
	const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	component.setText(content);
	return component;
}

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		if (!SERVERS.some((prefix) => toolName.startsWith(prefix))) return next();
		return {
			...next(),
			renderCall: (args, theme, context) => text(formatCall(toolName, args, theme as Theme), context),
			renderResult: (result, { expanded }, theme, context) => text(formatResult(toolName, result as Result, expanded, context.isError, theme as Theme), context),
		};
	});
}
