/**
 * claude-skills — gives Claude Code the skills Pi loads, so the two agents share them with Pi as the source of truth.
 *
 * At every session start (startup, /reload, /new, /resume, /fork), each skill Pi loaded at user scope gets a
 * symbolic link `~/.claude/skills/<name>` to the directory Pi loads it from: a new skill gets its link, a link with a
 * Pi skill's name is repointed to it, and a link into Pi's directories (the agent directory and the local packages
 * of settings.json) whose skill Pi no longer loads is removed. Claude Code reads each skill where Pi keeps it, so an
 * edit reaches both at once.
 *
 * It never deletes or replaces a file or a directory, and never touches a link into another place: a directory with
 * a Pi skill's name is reported instead. Project skills stay with their project and skills given with `--skill` for
 * one run are not linked; a link stays while Pi loads a skill of its name from any scope. With `--no-skills`, or with
 * skill commands disabled (the list of loaded skills comes from them), it changes nothing.
 */

import { lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Level = "info" | "warning" | "error";
type LoadedSkill = { name: string; dir: string; scope: "user" | "project" | "temporary" };
type Report = { linked: string[]; removed: string[]; problems: { message: string; level: Level }[] };

// Pi's own CLI flags that load no skill at all: mirroring then would remove every link.
const NO_SKILLS_FLAGS = new Set(["--no-skills", "-ns"]);
// A skill name becomes a directory entry: refuse anything that could leave ~/.claude/skills or hide the entry.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const expandHome = (path: string) => (path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

/** As Pi computes it: PI_CODING_AGENT_DIR, else ~/.pi/agent. */
function agentDir(): string {
	return resolve(expandHome(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")));
}

/** As Claude Code computes it: CLAUDE_CONFIG_DIR, else ~/.claude. */
function claudeSkillsDir(): string {
	return join(resolve(expandHome(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"))), "skills");
}

/** Where Pi's user skills live: the agent directory and the local packages declared in settings.json. */
function piRoots(settings: { packages?: unknown[] }): string[] {
	const roots = [agentDir()];
	for (const entry of settings.packages ?? []) {
		const source = typeof entry === "string" ? entry : (entry as { source?: unknown })?.source;
		if (typeof source !== "string" || !/^(~|\/|\.)/.test(source)) continue; // npm and git packages
		// Relative paths in the user's settings resolve from the agent directory.
		roots.push(resolve(agentDir(), expandHome(source)));
	}
	return roots;
}

function loadedSkills(pi: ExtensionAPI): LoadedSkill[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.map((command) => ({
			name: command.name.replace(/^skill:/, ""),
			dir: dirname(command.sourceInfo.path),
			scope: command.sourceInfo.scope,
		}));
}

/** Points `path` at `target` in one step, so Claude Code never sees the link missing or half made. */
function linkAt(path: string, target: string): void {
	const temporary = join(dirname(path), `.claude-skills-${process.pid}-${Date.now()}`);
	symlinkSync(target, temporary);
	try {
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);

function mirror(skills: LoadedSkill[], dir: string, roots: string[]): Report {
	const report: Report = { linked: [], removed: [], problems: [] };
	mkdirSync(dir, { recursive: true });

	for (const skill of skills.filter((s) => s.scope === "user")) {
		const path = join(dir, skill.name);
		if (!SAFE_NAME.test(skill.name)) {
			report.problems.push({ message: `skill "${skill.name}" (${skill.dir}) has a name that cannot be a link name; not linked`, level: "warning" });
			continue;
		}
		try {
			const stat = lstatSync(path, { throwIfNoEntry: false });
			if (stat && !stat.isSymbolicLink()) {
				report.problems.push({
					message: `${path} is not a link, so Claude Code does not see Pi's ${skill.name} (${skill.dir}). If it is an old copy, delete it and restart Pi.`,
					level: "warning",
				});
				continue;
			}
			if (stat && resolve(dir, readlinkSync(path)) === skill.dir) continue;
			linkAt(path, skill.dir);
			report.linked.push(skill.name);
		} catch (error) {
			report.problems.push({ message: `could not link ${path} to ${skill.dir}: ${(error as Error).message}`, level: "error" });
		}
	}

	const loaded = new Set(skills.map((s) => s.name));
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".") || loaded.has(entry)) continue; // hidden entries include other Pi processes' links in the making
		const path = join(dir, entry);
		try {
			if (!lstatSync(path).isSymbolicLink()) continue;
			const target = resolve(dir, readlinkSync(path));
			if (!roots.some((root) => inside(target, root))) continue;
			rmSync(path, { force: true }); // force: another Pi process starting at the same time may have removed it
			report.removed.push(entry);
		} catch (error) {
			report.problems.push({ message: `could not check or remove ${path}: ${(error as Error).message}`, level: "error" });
		}
	}
	return report;
}

function tell(ctx: ExtensionContext, message: string, level: Level): void {
	if (ctx.hasUI) ctx.ui.notify(`[claude-skills] ${message}`, level);
	else if (level !== "info") process.stderr.write(`[claude-skills] ${level}: ${message}\n`);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (process.argv.some((arg) => NO_SKILLS_FLAGS.has(arg))) return;
		const settings = pi.getSettings() as { packages?: unknown[]; enableSkillCommands?: boolean };
		if (settings.enableSkillCommands === false) {
			tell(ctx, "enableSkillCommands is off, so Pi does not list its skills: ~/.claude/skills is left as it is.", "warning");
			return;
		}

		const dir = claudeSkillsDir();
		let report: Report;
		try {
			report = mirror(loadedSkills(pi), dir, piRoots(settings));
		} catch (error) {
			tell(ctx, `could not update ${dir}: ${(error as Error).message}`, "error");
			return;
		}
		const changes = [
			report.linked.length ? `linked ${report.linked.join(", ")}` : "",
			report.removed.length ? `removed ${report.removed.join(", ")}` : "",
		].filter(Boolean);
		if (changes.length) tell(ctx, `Claude Code skills: ${changes.join("; ")}`, "info");
		for (const problem of report.problems) tell(ctx, problem.message, problem.level);
	});
}
