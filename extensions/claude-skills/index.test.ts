// Tests of the claude-skills extension: a throwaway HOME holding Pi's and Claude Code's directories, and the
// extension driven through the handler it registers, as Pi drives it.
//
// Run: node --test ~/.pi/agent/extensions/claude-skills/

import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { SlashCommandInfo, SourceInfo } from "@earendil-works/pi-coding-agent";

import extension from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type Note = { message: string; level: string };

const realArgv = process.argv;
let root: string;
let home: string;
let agentSkills: string;
let otherSkills: string;
let claudeSkills: string;
let commands: SlashCommandInfo[];
let notes: Note[];
let handlers: Record<string, Handler>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "claude-skills-ext-"));
	home = join(root, "home");
	agentSkills = join(home, ".pi", "agent", "skills");
	otherSkills = join(home, ".agents", "skills"); // another place Pi loads user skills from
	claudeSkills = join(home, ".claude", "skills");
	process.env.HOME = home;
	delete process.env.CLAUDE_CONFIG_DIR;
	process.argv = ["node", "pi"];
	commands = [];
	notes = [];

	// Pi's side of the contract, reduced to what the extension uses.
	handlers = {};
	extension({
		on: (name: string, handler: Handler) => void (handlers[name] = handler),
		getCommands: () => commands,
	} as never);
});

afterEach(() => {
	process.argv = realArgv;
	rmSync(root, { recursive: true, force: true });
});

/** A skill directory with its SKILL.md, as Pi would load it. */
function skillDir(base: string, name: string): string {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Test. Use when testing.\n---\n`);
	return dir;
}

function loaded(name: string, dir: string, scope: SourceInfo["scope"] = "user"): void {
	commands.push({
		name: `skill:${name}`,
		source: "skill",
		sourceInfo: { path: join(dir, "SKILL.md"), source: "local", scope, origin: "top-level" },
	} as SlashCommandInfo);
}

async function start(): Promise<void> {
	assert.ok(handlers.session_start, "the extension handles session_start");
	notes = [];
	await handlers.session_start(
		{ type: "session_start", reason: "startup" },
		{ hasUI: true, ui: { notify: (message: string, level = "info") => notes.push({ message, level }) } },
	);
}

const link = (name: string) => join(claudeSkills, name);
const target = (name: string) => readlinkSync(link(name));
const exists = (name: string) => lstatSync(link(name), { throwIfNoEntry: false }) !== undefined;
const isLink = (name: string) => lstatSync(link(name), { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

test("every user skill Pi loaded gets a link to its directory, and ~/.claude/skills is created", async () => {
	const alpha = skillDir(agentSkills, "alpha");
	const beta = skillDir(otherSkills, "beta");
	loaded("alpha", alpha);
	loaded("beta", beta);

	await start();

	assert.equal(target("alpha"), alpha);
	assert.equal(target("beta"), beta);
	assert.match(readFileSync(join(link("alpha"), "SKILL.md"), "utf8"), /name: alpha/);
	assert.ok(notes.some((n) => n.level === "info" && n.message.includes("alpha") && n.message.includes("beta")));
});

test("a link that is already right is left alone, with nothing said", async () => {
	const alpha = skillDir(agentSkills, "alpha");
	loaded("alpha", alpha);
	mkdirSync(claudeSkills, { recursive: true });
	symlinkSync(alpha, link("alpha"));

	await start();

	assert.equal(target("alpha"), alpha);
	assert.deepEqual(notes, []);
});

test("a link with a Pi skill's name is pointed at the directory Pi loads that skill from", async () => {
	const alpha = skillDir(agentSkills, "alpha");
	const elsewhere = skillDir(join(root, "elsewhere"), "alpha");
	loaded("alpha", alpha);
	mkdirSync(claudeSkills, { recursive: true });
	symlinkSync(elsewhere, link("alpha"));

	await start();

	assert.equal(target("alpha"), alpha);
	assert.ok(existsSync(join(elsewhere, "SKILL.md")), "the old target is not touched");
	assert.ok(notes.some((n) => n.message.includes("alpha")));
});

test("a link it made is removed once Pi no longer loads its skill, wherever the skill lived", async () => {
	const alpha = skillDir(agentSkills, "alpha");
	const beta = skillDir(otherSkills, "beta");
	loaded("alpha", alpha);
	loaded("beta", beta);
	await start();

	commands = [];
	rmSync(beta, { recursive: true }); // deleted: its link dangles
	await start();

	assert.ok(!exists("alpha"));
	assert.ok(!exists("beta"));
	assert.ok(existsSync(join(alpha, "SKILL.md")), "the skill itself is not touched");
	assert.ok(notes.some((n) => n.message.includes("alpha") && n.message.includes("beta")));
});

test("a link that already pointed at a Pi skill is taken over, so it goes with the skill", async () => {
	const beta = skillDir(otherSkills, "beta");
	loaded("beta", beta);
	mkdirSync(claudeSkills, { recursive: true });
	symlinkSync(beta, link("beta")); // made before the extension, by hand or by the dotfiles
	await start();

	commands = [];
	await start();

	assert.ok(!exists("beta"));
});

test("a link it made and someone repointed since is left alone when the skill goes", async () => {
	const alpha = skillDir(agentSkills, "alpha");
	loaded("alpha", alpha);
	await start();

	const mine = skillDir(join(root, "claude-only"), "alpha");
	rmSync(link("alpha"));
	symlinkSync(mine, link("alpha"));
	commands = [];
	await start();

	assert.equal(target("alpha"), mine);
});

test("a link is kept while Pi loads a skill of that name from a project", async () => {
	const alpha = skillDir(agentSkills, "alpha");
	loaded("alpha", alpha);
	await start();

	commands = [];
	loaded("alpha", skillDir(join(root, "repo", ".pi", "skills"), "alpha"), "project");
	await start();

	assert.equal(target("alpha"), alpha);
});

test("skills added for one run with --skill are not linked", async () => {
	loaded("once", skillDir(join(root, "scratch"), "once"), "temporary");

	await start();

	assert.ok(!exists("once"));
});

test("directories and links that are not Pi's are never touched", async () => {
	mkdirSync(join(claudeSkills, "synced"), { recursive: true });
	writeFileSync(join(claudeSkills, "synced", "keep.txt"), "keep\n");
	const foreign = skillDir(join(root, "claude-only"), "mine");
	symlinkSync(foreign, link("mine"));

	await start();

	assert.equal(readFileSync(join(claudeSkills, "synced", "keep.txt"), "utf8"), "keep\n");
	assert.equal(target("mine"), foreign);
	assert.deepEqual(notes, []);
});

test("a real directory with a Pi skill's name is reported and left as it is", async () => {
	loaded("alpha", skillDir(agentSkills, "alpha"));
	mkdirSync(link("alpha"), { recursive: true });
	writeFileSync(join(link("alpha"), "SKILL.md"), "an old copy\n");

	await start();

	assert.equal(readFileSync(join(link("alpha"), "SKILL.md"), "utf8"), "an old copy\n");
	assert.ok(!isLink("alpha"));
	assert.ok(notes.some((n) => n.level === "warning" && n.message.includes(link("alpha"))));
});

for (const flag of ["--no-skills", "-ns"]) {
	test(`nothing changes when Pi runs with ${flag}`, async () => {
		const kept = skillDir(agentSkills, "kept");
		loaded("kept", kept);
		await start();

		commands = [];
		process.argv = ["node", "pi", flag];
		await start();

		assert.equal(target("kept"), kept);
		assert.deepEqual(notes, []);
	});
}

test("a filesystem failure is reported with its cause, not thrown", async () => {
	loaded("alpha", skillDir(agentSkills, "alpha"));
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(claudeSkills, "not a directory\n");

	await start();

	assert.ok(notes.some((n) => n.level === "error" && n.message.includes(claudeSkills)));
});
