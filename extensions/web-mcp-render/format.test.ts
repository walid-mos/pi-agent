import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCall, formatResult, type Theme } from "./format.ts";

/** Tags text with its role; a role outside the visual grammar fails the test, not Pi at run time. */
const theme: Theme = {
	fg(role, text) {
		assert.ok(["toolTitle", "accent", "muted", "toolOutput", "error"].includes(role), `role ${role} is not one of the visual grammar's`);
		return `<${role}>${text}</${role}>`;
	},
	bold: (text) => `**${text}**`,
};

const text = (t: string) => ({ type: "text", text: t });

test("an e2e open_session call shows its target", () => {
	assert.equal(formatCall("mcp__e2e__open_session", { target: "firefox" }, theme), "<toolTitle>**e2e open_session**</toolTitle> <accent>firefox</accent>");
});

test("an e2e call shows the catalog tool it runs and that tool's URL", () => {
	const line = formatCall("mcp__e2e__call", { session: "01a2", tool: "navigate", args: { url: "http://localhost:5175/" } }, theme);
	assert.equal(line, "<toolTitle>**e2e navigate**</toolTitle> <accent>http://localhost:5175/</accent>");
});

test("an e2e tap shows its target node", () => {
	assert.equal(formatCall("mcp__e2e__call", { tool: "tap", args: { target: "n12006" } }, theme), "<toolTitle>**e2e tap**</toolTitle> <accent>n12006</accent>");
});

test("an e2e press shows its key", () => {
	assert.equal(formatCall("mcp__e2e__call", { tool: "press", args: { key: "Escape" } }, theme), "<toolTitle>**e2e press**</toolTitle> <accent>Escape</accent>");
});

test("a chrome call on a page shows the page id in muted", () => {
	assert.equal(formatCall("mcp__chrome__select_page", { pageId: 3 }, theme), "<toolTitle>**chrome select_page**</toolTitle> <muted>page 3</muted>");
});

test("an unknown argument shape still yields the tool name and never throws", () => {
	for (const args of [undefined, null, "navigate", 42, [], { tool: 7, args: "x" }, { args: null }]) {
		assert.match(formatCall("mcp__e2e__call", args, theme), /^<toolTitle>\*\*e2e (call|navigate)\*\*<\/toolTitle>/);
		assert.match(formatCall("mcp__chrome__list_pages", args, theme), /^<toolTitle>\*\*chrome list_pages\*\*<\/toolTitle>/);
	}
});

test("a collapsed chrome console result is one line with the message count", () => {
	const result = { content: [text("## Console messages\nShowing 1-1 of 1 (Page 1 of 1).\nmsgid=1 [log] probe-click (1 args)")] };
	assert.equal(formatResult("mcp__chrome__list_console_messages", result, false, false, theme), "<muted>1 console message</muted>");
});

test("a paginated chrome list counts every item, not the page shown", () => {
	const items = Array.from({ length: 20 }, (_, i) => `reqid=${i + 1} GET https://example.com/${i} [200]`).join("\n");
	const result = { content: [text(`## Network requests\nShowing 1-20 of 57 (Page 1 of 3).\nNext page: 1\n${items}`)] };
	assert.equal(formatResult("mcp__chrome__list_network_requests", result, false, false, theme), "<muted>57 network requests</muted>");
});

test("an empty chrome list counts zero", () => {
	const result = { content: [text("## Console messages\n<no console messages found>")] };
	assert.equal(formatResult("mcp__chrome__list_console_messages", result, false, false, theme), "<muted>0 console messages</muted>");
});

test("a collapsed chrome page list counts its pages", () => {
	const result = { content: [text("## Pages\n1: Example Domain (https://example.com/) [selected] isolatedContext=isolated-context-1\n2: about:blank")] };
	assert.equal(formatResult("mcp__chrome__list_pages", result, false, false, theme), "<muted>2 pages</muted>");
});

test("a collapsed chrome select_page result counts the pages it lists", () => {
	const result = { content: [text("## Pages\n1: Astore (http://localhost:5175/backoffice) [selected] isolatedContext=isolated-context-1\n2: about:blank")] };
	assert.equal(formatResult("mcp__chrome__select_page", result, false, false, theme), "<muted>2 pages</muted>");
});

test("another collapsed result is its first line that is not a heading", () => {
	const result = { content: [text("Navigated to https://example.com.\nTest line: await app.open(\"https://example.com\");")] };
	assert.equal(formatResult("mcp__e2e__call", result, false, false, theme), "<muted>Navigated to https://example.com.</muted>");
	const trace = { content: [text("## Summary of Performance trace findings:\nURL: https://example.com/")] };
	assert.equal(formatResult("mcp__chrome__performance_stop_trace", trace, false, false, theme), "<muted>URL: https://example.com/</muted>");
});

test("a result with an image says so in muted, first, so that cutting a long line keeps it", () => {
	const result = { content: [text("Screenshot attached: 768 by 432 pixels."), { type: "image", data: "AAAA", mimeType: "image/png" }] };
	assert.equal(formatResult("mcp__e2e__call", result, false, false, theme), "<muted>1 image ·</muted> <muted>Screenshot attached: 768 by 432 pixels.</muted>");
	assert.match(formatResult("mcp__e2e__call", result, true, false, theme), /^<muted>1 image<\/muted>\n<toolOutput>Screenshot/);
});

test("an error result uses the error role, collapsed and expanded", () => {
	const result = { content: [text("Could not connect to Chrome. Check if Chrome is running.\nCause: connect ECONNREFUSED 127.0.0.1:9322")] };
	assert.equal(formatResult("mcp__chrome__list_pages", result, false, true, theme), "<error>Could not connect to Chrome. Check if Chrome is running.</error>");
	assert.equal(formatResult("mcp__chrome__list_pages", result, true, true, theme), "<error>Could not connect to Chrome. Check if Chrome is running.\nCause: connect ECONNREFUSED 127.0.0.1:9322</error>");
});

test("an expanded result shows the first lines of the text in toolOutput", () => {
	const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
	const out = formatResult("mcp__e2e__open_session", { content: [text(long)] }, true, false, theme);
	assert.match(out, /^<toolOutput>line 1\n/);
	assert.match(out, /line 20<\/toolOutput>/);
	assert.doesNotMatch(out, /line 21\b/);
	assert.match(out, /<muted>… 10 more lines<\/muted>$/);
});

test("before the result exists, a pending line is shown", () => {
	assert.equal(formatResult("mcp__e2e__call", { content: [] }, false, false, theme), "<muted>…</muted>");
	assert.equal(formatResult("mcp__e2e__call", undefined, false, false, theme), "<muted>…</muted>");
});
