/**
 * Draws the calls and results of the e2e and chrome MCP servers with the functions of `format.ts`, wrapped in Pi's
 * Text; a collapsed result is one line, so it keeps only its first wrapped line. Every other tool keeps what the
 * other resolvers give it.
 */

import { type ExtensionAPI, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";

import { formatCall, formatResult, type Result, type Theme } from "./format.ts";

const SERVERS = ["mcp__e2e__", "mcp__chrome__"];

/** The previous Text of the slot, updated in place, or a new one (a collapsed result was not a Text). */
function text(content: string, context: { lastComponent?: unknown }): Text {
	const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	component.setText(content);
	return component;
}

/**
 * The first line `Text` would draw, as Pi cuts its own collapsed output: pi-tui's ellipsis follows a full reset, which
 * would clear the tool box's background behind it.
 */
function firstLine(content: string): Component {
	return { render: (width) => truncateToVisualLines(content, 1, width, 0, "start").visualLines, invalidate() {} };
}

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		if (!SERVERS.some((prefix) => toolName.startsWith(prefix))) return next();
		return {
			...next(),
			renderCall: (args, theme, context) => text(formatCall(toolName, args, theme as Theme), context),
			renderResult: (result, { expanded }, theme, context) => {
				const content = formatResult(toolName, result as Result, expanded, context.isError, theme as Theme);
				return expanded ? text(content, context) : firstLine(content);
			},
		};
	});
}
