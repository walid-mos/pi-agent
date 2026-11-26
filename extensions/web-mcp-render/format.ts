/**
 * How calls to the e2e and chrome MCP servers look in Pi's transcript, as pure functions of the tool name, the
 * arguments or the result. The visual grammar of the web package's tools: the server and tool in `toolTitle` bold,
 * the main argument in `accent`, options in `muted`; a collapsed result is one `muted` line; an expanded one is the
 * text in `toolOutput`; a failure is its text in `error`. Arguments and results come from outside servers, so any
 * shape is accepted.
 */

export type Role = "toolTitle" | "accent" | "muted" | "toolOutput" | "error";

export type Theme = { fg(role: Role, text: string): string; bold(text: string): string };

export type Result = { content?: { type: string; text?: string }[] } | undefined;

/** Lines of a result's text shown when it is expanded. */
const EXPANDED_LINES = 20;

/** The argument a call is about, in this order of preference. */
const MAIN_ARGUMENTS = ["url", "target", "selector", "path", "key", "tool"];

/** chrome's lists, by the tool that returns one: the line that starts each item, and the item's name in the singular and the plural. */
const LISTS: Record<string, { item: RegExp; one: string; many: string }> = {
	list_console_messages: { item: /^msgid=/, one: "console message", many: "console messages" },
	list_network_requests: { item: /^reqid=/, one: "network request", many: "network requests" },
	list_pages: { item: /^\d+: /, one: "page", many: "pages" },
	select_page: { item: /^\d+: /, one: "page", many: "pages" },
};

export function formatCall(toolName: string, args: unknown, theme: Theme): string {
	const { server, tool } = split(toolName);
	const given = record(args);
	// An e2e `call` runs a tool of the session's catalog: that tool is what the call does.
	const runs = server === "e2e" && tool === "call" && typeof given.tool === "string" ? { tool: given.tool, args: record(given.args) } : { tool, args: given };
	const parts = [theme.fg("toolTitle", theme.bold(`${server} ${runs.tool}`))];
	const main = MAIN_ARGUMENTS.map((key) => runs.args[key]).find((value) => typeof value === "string" && value !== "");
	if (typeof main === "string") parts.push(theme.fg("accent", main));
	if (typeof runs.args.pageId === "number") parts.push(theme.fg("muted", `page ${runs.args.pageId}`));
	return parts.join(" ");
}

export function formatResult(toolName: string, result: Result, expanded: boolean, isError: boolean, theme: Theme): string {
	const content = Array.isArray(result?.content) ? result.content : [];
	if (content.length === 0) return theme.fg("muted", "…");
	const text = content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");
	if (isError) return theme.fg("error", expanded ? text : firstLine(text));
	const images = content.filter((c) => c.type === "image").length;
	const imageNote = images > 0 ? `${images} ${images === 1 ? "image" : "images"}` : undefined;
	if (expanded) {
		const lines = text.split("\n");
		const shown = imageNote ? [theme.fg("muted", imageNote)] : [];
		shown.push(theme.fg("toolOutput", lines.slice(0, EXPANDED_LINES).join("\n")));
		if (lines.length > EXPANDED_LINES) shown.push(theme.fg("muted", `… ${lines.length - EXPANDED_LINES} more lines`));
		return shown.join("\n");
	}
	const { server, tool } = split(toolName);
	const list = server === "chrome" ? LISTS[tool] : undefined;
	const line = theme.fg("muted", list ? counted(text, list) : firstLine(text));
	return imageNote ? `${theme.fg("muted", `${imageNote} ·`)} ${line}` : line;
}

/** `mcp__<server>__<tool>`; a name of another shape is its own tool. */
function split(toolName: string): { server: string; tool: string } {
	const [prefix, server, ...tool] = toolName.split("__");
	return prefix === "mcp" && server && tool.length > 0 ? { server, tool: tool.join("__") } : { server: "", tool: toolName };
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A paginated list states its total ("Showing 1-20 of 57"); a list on one page is counted. */
function counted(text: string, list: (typeof LISTS)[string]): string {
	const total = /^Showing \d+-\d+ of (\d+)/m.exec(text);
	const count = total ? Number(total[1]) : text.split("\n").filter((line) => list.item.test(line)).length;
	return `${count} ${count === 1 ? list.one : list.many}`;
}

/** The first line that is neither empty nor a Markdown heading. */
function firstLine(text: string): string {
	const lines = text.split("\n");
	return lines.find((line) => line.trim() !== "" && !line.startsWith("#")) ?? lines[0];
}
