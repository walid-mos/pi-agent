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
	assert.equal(formatCall("e2e", "open_session", { target: "firefox" }, theme), "<toolTitle>**e2e open_session**</toolTitle> <accent>firefox</accent>");
});

test("an e2e call shows the catalog tool it runs and that tool's URL", () => {
	const line = formatCall("e2e", "call", { session: "01a2", tool: "navigate", args: { url: "http://localhost:5175/" } }, theme);
	assert.equal(line, "<toolTitle>**e2e navigate**</toolTitle> <accent>http://localhost:5175/</accent>");
});

test("an e2e tap shows its target node", () => {
	assert.equal(formatCall("e2e", "call", { tool: "tap", args: { target: "n12006" } }, theme), "<toolTitle>**e2e tap**</toolTitle> <accent>n12006</accent>");
});

test("an e2e call shows the arguments that sit beside the catalog tool", () => {
	assert.equal(formatCall("e2e", "call", { session: "01a2", tool: "tap", target: "n42" }, theme), "<toolTitle>**e2e tap**</toolTitle> <accent>n42</accent>");
	assert.equal(formatCall("e2e", "call", { session: "01a2", tool: "observe" }, theme), "<toolTitle>**e2e observe**</toolTitle>");
});

test("escape sequences and control characters of an argument are not drawn", () => {
	const line = formatCall("e2e", "call", { tool: "navigate\x1b[2J", args: { url: "http://localhost:5175/\x1b]0;title\x07\r" } }, theme);
	assert.equal(line, "<toolTitle>**e2e navigate**</toolTitle> <accent>http://localhost:5175/</accent>");
});

test("an e2e press shows its key", () => {
	assert.equal(formatCall("e2e", "call", { tool: "press", args: { key: "Escape" } }, theme), "<toolTitle>**e2e press**</toolTitle> <accent>Escape</accent>");
});

test("a chrome call on a page shows the page id in muted", () => {
	assert.equal(formatCall("chrome", "select_page", { pageId: 3 }, theme), "<toolTitle>**chrome select_page**</toolTitle> <muted>page 3</muted>");
});

test("an unknown argument shape still yields the tool name and never throws", () => {
	for (const args of [undefined, null, "navigate", 42, [], { tool: 7, args: "x" }, { args: null }]) {
		assert.equal(formatCall("e2e", "call", args, theme), "<toolTitle>**e2e call**</toolTitle>");
		assert.match(formatCall("chrome", "list_pages", args, theme), /^<toolTitle>\*\*chrome list_pages\*\*<\/toolTitle>/);
	}
});

test("a collapsed chrome console result is one line with the message count", () => {
	const result = { content: [text("## Console messages\nShowing 1-1 of 1 (Page 1 of 1).\nmsgid=1 [log] probe-click (1 args)")] };
	assert.equal(formatResult(result, false, false, theme), "<muted>1 console message</muted>");
});

test("a paginated chrome list counts every item, not the page shown", () => {
	const items = Array.from({ length: 20 }, (_, i) => `reqid=${i + 1} GET https://example.com/${i} [200]`).join("\n");
	const result = { content: [text(`## Network requests\nShowing 1-20 of 57 (Page 1 of 3).\nNext page: 1\n${items}`)] };
	assert.equal(formatResult(result, false, false, theme), "<muted>57 network requests</muted>");
});

test("an empty chrome list counts zero", () => {
	const result = { content: [text("## Console messages\n<no console messages found>")] };
	assert.equal(formatResult(result, false, false, theme), "<muted>0 console messages</muted>");
});

test("a collapsed chrome page list counts its pages", () => {
	const result = { content: [text("## Pages\n1: Example Domain (https://example.com/) [selected] isolatedContext=isolated-context-1\n2: about:blank")] };
	assert.equal(formatResult(result, false, false, theme), "<muted>2 pages</muted>");
});

test("a chrome list that follows other lines is still counted", () => {
	const emulated = { content: [text("Emulating network conditions: Slow 3G\nDefault navigation timeout set to 100000 ms\n## Network requests\nShowing 1-20 of 57 (Page 1 of 3).\nNext page: 1\nreqid=1 GET https://example.com/ [200]")] };
	assert.equal(formatResult(emulated, false, false, theme), "<muted>57 network requests</muted>");
	const reconnected = { content: [text("Note: the browser was restarted or reconnected since the last call. Page ids have changed. Call list_pages to see open pages.\n## Pages\n1: about:blank [selected]")] };
	assert.equal(formatResult(reconnected, false, false, theme), "<muted>1 page</muted>");
});

test("another collapsed result is its first line that is not a heading", () => {
	const result = { content: [text("Navigated to https://example.com.\nTest line: await app.open(\"https://example.com\");")] };
	assert.equal(formatResult(result, false, false, theme), "<muted>Navigated to https://example.com.</muted>");
	const trace = { content: [text("## Summary of Performance trace findings:\nURL: https://example.com/")] };
	assert.equal(formatResult(trace, false, false, theme), "<muted>URL: https://example.com/</muted>");
});

test("a line that starts with # and no space is not a heading", () => {
	const result = { content: [text("#n31 button \"Sign in\"\n#n32 link \"Help\"\n2 nodes match.")] };
	assert.equal(formatResult(result, false, false, theme), "<muted>#n31 button \"Sign in\"</muted>");
});

test("escape sequences and control characters of a result are not drawn", () => {
	const result = { content: [text("\x1b[2J\x1b[31mBuild failed\x1b[0m\r\nmsgid=1 [log] \x07done")] };
	assert.equal(formatResult(result, false, false, theme), "<muted>Build failed</muted>");
	assert.equal(formatResult(result, true, false, theme), "<toolOutput>Build failed\nmsgid=1 [log] done</toolOutput>");
	assert.equal(formatResult(result, true, true, theme), "<error>Build failed\nmsgid=1 [log] done</error>");
});

test("a result that is only an image is its image note", () => {
	const result = { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] };
	assert.equal(formatResult(result, false, false, theme), "<muted>1 image</muted>");
	assert.equal(formatResult(result, true, false, theme), "<muted>1 image</muted>");
});

test("a result with an image says so in muted, first, so that cutting a long line keeps it", () => {
	const result = { content: [text("Screenshot attached: 768 by 432 pixels."), { type: "image", data: "AAAA", mimeType: "image/png" }] };
	assert.equal(formatResult(result, false, false, theme), "<muted>1 image · Screenshot attached: 768 by 432 pixels.</muted>");
	assert.match(formatResult(result, true, false, theme), /^<muted>1 image<\/muted>\n<toolOutput>Screenshot/);
});

test("an error result uses the error role, collapsed and expanded", () => {
	const result = { content: [text("Could not connect to Chrome. Check if Chrome is running.\nCause: connect ECONNREFUSED 127.0.0.1:9322")] };
	assert.equal(formatResult(result, false, true, theme), "<error>Could not connect to Chrome. Check if Chrome is running.</error>");
	assert.equal(formatResult(result, true, true, theme), "<error>Could not connect to Chrome. Check if Chrome is running.\nCause: connect ECONNREFUSED 127.0.0.1:9322</error>");
});

test("an expanded result shows the first lines of the text in toolOutput", () => {
	const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
	const out = formatResult({ content: [text(long)] }, true, false, theme);
	assert.match(out, /^<toolOutput>line 1\n/);
	assert.match(out, /line 20<\/toolOutput>/);
	assert.doesNotMatch(out, /line 21\b/);
	assert.match(out, /<muted>… 10 more lines<\/muted>$/);
});

test("a result with no content draws nothing, failed or not", () => {
	assert.equal(formatResult({ content: [] }, false, false, theme), "");
	assert.equal(formatResult(undefined, true, false, theme), "");
	assert.equal(formatResult({ content: [] }, false, true, theme), "");
});
