// Tests of the chezmoi extension: the real chezmoi against a throwaway HOME, and the extension driven through
// the handlers it registers, as Pi drives it.
//
// Run: node --test ~/.pi/agent/extensions/chezmoi/

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import extension from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Patch = { content: { type: string; text: string }[] } | undefined;

const realPath = process.env.PATH;
let root: string;
let home: string;
let source: string;
let handlers: Record<string, Handler>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "chezmoi-ext-"));
	home = join(root, "home");
	source = join(root, "source");
	mkdirSync(join(home, ".config", "chezmoi"), { recursive: true });
	mkdirSync(source);
	process.env.HOME = home;
	process.env.PATH = realPath;
	delete process.env.XDG_CONFIG_HOME;
	writeFileSync(join(home, ".config", "chezmoi", "chezmoi.toml"), `sourceDir = ${JSON.stringify(source)}\n`);
	writeFileSync(join(source, "dot_managed"), "managed\n");
	writeFileSync(join(source, "README.md"), "notes\n");
	writeFileSync(join(source, ".chezmoiignore"), "README.md\n");
	execFileSync("chezmoi", ["apply"]);
	writeFileSync(join(home, ".unmanaged"), "unmanaged\n");

	// Pi's side of the contract, reduced to what the extension uses: it registers handlers by event name.
	handlers = {};
	extension({ on: (name: string, handler: Handler) => void (handlers[name] = handler) } as never);
});

afterEach(() => {
	process.env.PATH = realPath;
	rmSync(root, { recursive: true, force: true });
});

/** What the extension answers to the result of one tool call on `path`. */
async function result(toolName: string, path: string, options: { isError?: boolean; cwd?: string } = {}): Promise<Patch> {
	assert.ok(handlers.tool_result, "the extension handles tool_result");
	const event = {
		type: "tool_result",
		toolName,
		toolCallId: "call-1",
		input: { path },
		content: [{ type: "text", text: "tool output" }],
		details: undefined,
		isError: options.isError ?? false,
	};
	return (await handlers.tool_result(event, { cwd: options.cwd ?? root })) as Patch;
}

const texts = (patch: Patch) => (patch?.content ?? []).map((part) => part.text);

test("an edit of a managed file is flagged, after the tool's own output", async () => {
	const patch = await result("edit", join(home, ".managed"));
	assert.equal(texts(patch).length, 2);
	assert.equal(texts(patch)[0], "tool output");
	assert.match(texts(patch)[1], /chezmoi/);
	assert.match(texts(patch)[1], /dots -m/);
	assert.ok(texts(patch)[1].includes(join(home, ".managed")));
});

test("a write to a managed file is flagged too", async () => {
	const patch = await result("write", join(home, ".managed"));
	assert.match(texts(patch)[1], /dots -m/);
});

test("an edit of a file of the chezmoi repository is flagged, even one chezmoi deploys nowhere", async () => {
	assert.match(texts(await result("edit", join(source, "dot_managed")))[1], /dots -m/);
	assert.match(texts(await result("edit", join(source, "README.md")))[1], /dots -m/);
});

test("a file chezmoi does not manage is left alone", async () => {
	assert.equal(await result("edit", join(home, ".unmanaged")), undefined);
	assert.equal(await result("write", join(root, "elsewhere.txt")), undefined);
});

test("a failed edit is left alone", async () => {
	assert.equal(await result("edit", join(home, ".managed"), { isError: true }), undefined);
});

test("a tool that does not write the file is left alone", async () => {
	assert.equal(await result("read", join(home, ".managed")), undefined);
});

test("a path written with ~ or an @ prefix is resolved as the tools resolve it", async () => {
	assert.match(texts(await result("edit", "~/.managed"))[1], /dots -m/);
	await handlers.session_compact({ type: "session_compact" }, { cwd: root });
	assert.match(texts(await result("edit", `@${join(home, ".managed")}`))[1], /dots -m/);
});

test("a relative path is resolved against the working directory", async () => {
	assert.match(texts(await result("edit", ".managed", { cwd: home }))[1], /dots -m/);
	assert.equal(await result("edit", ".managed", { cwd: root }), undefined);
});

test("a file is flagged once, then again after a compaction dropped the first note", async () => {
	assert.ok(await result("edit", join(home, ".managed")));
	assert.equal(await result("edit", join(home, ".managed")), undefined);
	assert.ok(handlers.session_compact, "the extension handles session_compact");
	await handlers.session_compact({ type: "session_compact" }, { cwd: root });
	assert.ok(await result("edit", join(home, ".managed")));
});

test("on a machine without chezmoi, nothing is flagged and nothing fails", async () => {
	const empty = join(root, "empty-bin");
	mkdirSync(empty);
	process.env.PATH = empty;
	assert.equal(await result("edit", join(home, ".managed")), undefined);
});

test("a chezmoi that fails is reported in the result, not taken for 'not managed'", async () => {
	writeFileSync(join(home, ".config", "chezmoi", "chezmoi.toml"), "sourceDir = [broken\n");
	const patch = await result("edit", join(home, ".managed"));
	assert.equal(texts(patch)[0], "tool output");
	assert.match(texts(patch)[1], /chezmoi/);
	assert.match(texts(patch)[1], /could not/);
});
