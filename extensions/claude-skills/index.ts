/**
 * claude-skills — gives Claude Code the skills Pi loads, so the two agents share them with Pi as the source of truth.
 *
 * At every session start (startup, /reload, /new, /resume, /fork), each skill Pi loaded at user scope gets a
 * symbolic link `~/.claude/skills/<name>` to the directory Pi loads it from, and a link with a Pi skill's name is
 * repointed to it. Claude Code reads each skill where Pi keeps it, so an edit reaches both at once. The links it made
 * are recorded in `~/.claude/skills/.pi-links.json`; once Pi no longer loads a skill, its link is removed if it still
 * points where it was made to.
 *
 * It never deletes or replaces a file or a directory, and never removes a link it did not make: a directory with a Pi
 * skill's name is reported instead. Project skills stay with their project and skills given with `--skill` for one
 * run are not linked; a link stays while Pi loads a skill of its name from any scope. With `--no-skills` it changes
 * nothing.
 */

import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, SourceInfo } from "@earendil-works/pi-coding-agent";

type Level = "info" | "warning" | "error";
type LoadedSkill = { name: string; dir: string; scope: SourceInfo["scope"] };
/** Link name to the skill directory the link was made to point at. */
type Manifest = Record<string, string>;
type Report = { linked: string[]; removed: string[]; problems: { message: string; level: Level }[] };

// Pi's own CLI flags that load no skill at all: mirroring then would remove every link. The session API does not
// say that skills were disabled, so the flags are read where Pi reads them.
const NO_SKILLS_FLAGS = new Set(["--no-skills", "-ns"]);
// A skill name becomes a directory entry: refuse anything that could leave ~/.claude/skills or hide the entry.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Hidden, so Claude Code does not take it for a skill.
const MANIFEST = ".pi-links.json";

/** As Claude Code computes it: CLAUDE_CONFIG_DIR, else ~/.claude. */
function claudeSkillsDir(): string {
	return join(resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")), "skills");
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

/** Writes `path` in one step through a hidden temporary entry, so Claude Code never sees it half made. */
function replace(path: string, make: (temporary: string) => void): void {
	const temporary = join(dirname(path), `.claude-skills-${process.pid}-${Date.now()}`);
	make(temporary);
	try {
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function readManifest(path: string): Manifest {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Manifest;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; // first run
		throw new Error(`${path} is unreadable (${(error as Error).message}); delete it to start the record over`);
	}
}

const pointsAt = (path: string, dir: string) => resolve(dirname(path), readlinkSync(path)) === dir;

function mirror(skills: LoadedSkill[], dir: string): Report {
	const report: Report = { linked: [], removed: [], problems: [] };
	mkdirSync(dir, { recursive: true });
	const manifestPath = join(dir, MANIFEST);
	const before = readManifest(manifestPath);
	const manifest: Manifest = { ...before };

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
			if (!stat || !pointsAt(path, skill.dir)) {
				replace(path, (temporary) => symlinkSync(skill.dir, temporary));
				report.linked.push(skill.name);
			}
			manifest[skill.name] = skill.dir;
		} catch (error) {
			report.problems.push({ message: `could not link ${path} to ${skill.dir}: ${(error as Error).message}`, level: "error" });
		}
	}

	const loaded = new Set(skills.map((s) => s.name));
	for (const [name, made] of Object.entries(before)) {
		if (loaded.has(name)) continue;
		const path = join(dir, name);
		try {
			if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() && pointsAt(path, made)) {
				rmSync(path, { force: true }); // force: another Pi process starting at the same time may have removed it
				report.removed.push(name);
			}
			delete manifest[name]; // gone, repointed or replaced since: no longer this extension's
		} catch (error) {
			report.problems.push({ message: `could not check or remove ${path}: ${(error as Error).message}`, level: "error" });
		}
	}

	if (JSON.stringify(manifest) !== JSON.stringify(before)) {
		replace(manifestPath, (temporary) => writeFileSync(temporary, `${JSON.stringify(manifest, null, "\t")}\n`));
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
		const dir = claudeSkillsDir();
		let report: Report;
		try {
			report = mirror(loadedSkills(pi), dir);
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
