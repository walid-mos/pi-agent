/**
 * Draws the calls and results of the e2e and chrome MCP servers with the functions of `format.ts`, wrapped in Pi's
 * Text. A collapsed result is one line, so it keeps only its first wrapped line, as Pi cuts its own collapsed output:
 * pi-tui's ellipsis follows a full reset, which would clear the tool box's background behind it. Every other tool
 * keeps what the other resolvers give it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { formatCall, formatResult, type Result, type Theme } from "./format.ts";

/** The name Pi gives a tool of the servers drawn here: the server, then the tool. */
const DRAWN = /^mcp__(e2e|chrome)__(.+)$/;

/** A Text that draws only its first wrapped lines. */
class Lines extends Text {
	maxLines = Infinity;

	render(width: number): string[] {
		return super.render(width).slice(0, this.maxLines);
	}
}

/** The previous component of the slot, updated in place, or a new one. */
function lines(content: string, maxLines: number, context: { lastComponent?: unknown }): Lines {
	const component = context.lastComponent instanceof Lines ? context.lastComponent : new Lines("", 0, 0);
	component.setText(content);
	component.maxLines = maxLines;
	return component;
}

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		const drawn = DRAWN.exec(toolName);
		if (!drawn) return next();
		const [, server, tool] = drawn;
		return {
			...next(),
			renderCall: (args, theme, context) => lines(formatCall(server, tool, args, theme as Theme), Infinity, context),
			renderResult: (result, { expanded }, theme, context) => {
				const content = formatResult(result as Result, expanded, context.isError, theme as Theme);
				return lines(content, expanded ? Infinity : 1, context);
			},
		};
	});
}
