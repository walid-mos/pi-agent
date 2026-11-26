/**
 * How calls to the e2e and chrome MCP servers look in Pi's transcript, as pure functions of the server, the tool and
 * its arguments, or of the result. The visual grammar of the web package's tools: the server and tool in `toolTitle` bold,
 * the main argument in `accent`, options in `muted`; a collapsed result is one `muted` line; an expanded one is the
 * text in `toolOutput`; a failure is its text in `error`. Arguments and results come from outside servers, so any
 * shape is accepted, and their text is drawn without its escape sequences and control characters.
 */

import { stripVTControlCharacters } from "node:util";

export type Role = "toolTitle" | "accent" | "muted" | "toolOutput" | "error";

export type Theme = { fg(role: Role, text: string): string; bold(text: string): string };

export type Result = { content?: { type: string; text?: string }[] } | undefined;

/** Lines of a result's text shown when it is expanded. */
const EXPANDED_LINES = 20;

/** The argument a call is about, in this order of preference. */
const MAIN_ARGUMENTS = ["url", "target", "selector", "path", "key", "tool"];

/**
 * chrome's lists, by the heading that opens one, whatever tool returns it and whatever lines come before it (chrome's
 * notes and emulation state, Pi's warning that it cut the text): the line that starts each item, and what an item is
 * called.
 */
const LISTS = new Map([
	["## Console messages", { item: /^msgid=/, name: "console message" }],
	["## Network requests", { item: /^reqid=/, name: "network request" }],
	["## Pages", { item: /^\d+: /, name: "page" }],
]);

export function formatCall(server: string, tool: string, args: unknown, theme: Theme): string {
	const given = record(args);
	// An e2e `call` runs a tool of the session's catalog: that tool is what the call does. e2e takes its arguments in
	// `args` or beside `tool`.
	const { tool: catalogTool, args: inside, ...beside } = given;
	const runs = server === "e2e" && tool === "call" && typeof catalogTool === "string" ? { tool: catalogTool, args: { ...beside, ...record(inside) } } : { tool, args: given };
	const parts = [theme.fg("toolTitle", theme.bold(printable(`${server} ${runs.tool}`)))];
	const main = MAIN_ARGUMENTS.map((key) => runs.args[key]).find((value): value is string => typeof value === "string" && value !== "");
	if (main) parts.push(theme.fg("accent", printable(main)));
	if (typeof runs.args.pageId === "number") parts.push(theme.fg("muted", `page ${runs.args.pageId}`));
	return parts.join(" ");
}

export function formatResult(result: Result, expanded: boolean, isError: boolean, theme: Theme): string {
	const content = Array.isArray(result?.content) ? result.content : [];
	if (content.length === 0) return "";
	const text = printable(
		content
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text)
			.join("\n"),
	);
	if (isError) return theme.fg("error", expanded ? text : firstLine(text));
	const images = content.filter((c) => c.type === "image").length;
	const imageNote = images > 0 ? counted(images, "image") : undefined;
	const lines = text.split("\n");
	if (expanded) {
		const shown = imageNote ? [theme.fg("muted", imageNote)] : [];
		if (text) shown.push(theme.fg("toolOutput", lines.slice(0, EXPANDED_LINES).join("\n")));
		if (lines.length > EXPANDED_LINES) shown.push(theme.fg("muted", `… ${lines.length - EXPANDED_LINES} more lines`));
		return shown.join("\n");
	}
	const list = lines.map((line) => LISTS.get(line)).find((found) => found !== undefined);
	const line = list ? counted(itemCount(text, list.item), list.name) : firstLine(text);
	return theme.fg("muted", [imageNote, line].filter(Boolean).join(" · "));
}

/** Text from outside as a terminal can draw it: no escape sequence, and no control character but the tab and the newline. */
function printable(text: string): string {
	return stripVTControlCharacters(text).replace(/[^\P{Cc}\t\n]/gu, "");
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A paginated list states its total ("Showing 1-20 of 57"); a list on one page is counted. */
function itemCount(text: string, item: RegExp): number {
	const total = /^Showing \d+-\d+ of (\d+)/m.exec(text);
	return total ? Number(total[1]) : text.split("\n").filter((line) => item.test(line)).length;
}

function counted(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The first line that is neither empty nor a Markdown heading, or the first line when every line is one of those. */
function firstLine(text: string): string {
	const lines = text.split("\n");
	return lines.find((line) => line.trim() !== "" && !/^#+ /.test(line)) ?? lines[0];
}
