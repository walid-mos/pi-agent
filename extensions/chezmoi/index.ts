/**
 * chezmoi — tells the agent when a file it has just edited or written is one of the dotfiles managed by chezmoi.
 *
 * chezmoi deploys those files from a git repository. A change made to a deployed file exists only on this machine,
 * and a change made in the repository is not deployed, until it is saved with `dots -m`; nothing in the file's path
 * says so. The extension adds one note to the result of the `edit` or `write` and leaves the procedure to the
 * `chezmoi` skill.
 *
 * It asks the chezmoi installed on the machine at each edit (two calls, a few tens of milliseconds) and keeps no
 * list, so a file chezmoi starts managing during the session is known at once. On a machine without chezmoi no
 * file is managed and nothing is flagged. No network call, no file read or written, no dependency.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// chezmoi answers in tens of milliseconds; past this it is stuck (waiting on a prompt or a lock), not slow.
const TIMEOUT_MS = 5_000;

/** What chezmoi manages on this machine, as read for one edit. */
type Dotfiles =
	| { state: "absent" } // no chezmoi on this machine: no file is managed
	| { state: "unreadable"; reason: string } // chezmoi is installed and failed
	| { state: "read"; sourceDir: string; deployed: Set<string> };

type Note = {
	/** Notes with the same key are given once: the file's path, or one key for every chezmoi failure. */
	key: string;
	text: string;
};

function chezmoi(args: string[]): Promise<string> {
	return new Promise((resolveOutput, reject) => {
		execFile("chezmoi", args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
			if (!error) resolveOutput(stdout);
			else reject(Object.assign(error, { reason: stderr.trim() || error.message }));
		});
	});
}

async function readDotfiles(): Promise<Dotfiles> {
	try {
		const sourceDir = (await chezmoi(["source-path"])).trim();
		const deployed = await chezmoi(["managed", "--include=files,symlinks", "--path-style=absolute"]);
		return { state: "read", sourceDir, deployed: new Set(deployed.split("\n").filter(Boolean)) };
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & { reason?: string };
		if (failure.code === "ENOENT") return { state: "absent" };
		return { state: "unreadable", reason: failure.reason ?? failure.message };
	}
}

/** The path as Pi's file tools resolve it: an optional `@` prefix, `~` for the home directory, else from `cwd`. */
function resolvePath(path: string, cwd: string): string {
	const plain = path.startsWith("@") ? path.slice(1) : path;
	if (plain === "~") return homedir();
	if (plain.startsWith("~/")) return resolve(homedir(), plain.slice(2));
	return resolve(cwd, plain);
}

async function noteFor(path: string): Promise<Note | undefined> {
	const dotfiles = await readDotfiles();
	switch (dotfiles.state) {
		case "absent":
			return undefined;
		case "unreadable":
			return {
				key: "chezmoi unreadable",
				text:
					`[chezmoi] chezmoi could not say whether ${path} is one of the dotfiles it manages: ${dotfiles.reason}\n` +
					"Until it works again, check each file you change under the home directory with `chezmoi source-path <file>`.",
			};
		case "read":
			if (dotfiles.deployed.has(path)) {
				return {
					key: path,
					text:
						`[chezmoi] ${path} is one of the dotfiles chezmoi deploys from ${dotfiles.sourceDir}: this change exists ` +
						"only on this machine until it is saved there. Read the `chezmoi` skill and save it with `dots -m` before you finish.",
				};
			}
			if (path.startsWith(dotfiles.sourceDir + sep)) {
				return {
					key: path,
					text:
						`[chezmoi] ${path} is a file of the repository chezmoi deploys the dotfiles from: this change is neither ` +
						"deployed on this machine nor saved. Read the `chezmoi` skill, then apply it and save it with `dots -m` before you finish.",
				};
			}
			return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	// A file edited ten times is flagged once. Emptied when a compaction may have dropped the notes from the context.
	const noted = new Set<string>();
	pi.on("session_compact", () => noted.clear());

	pi.on("tool_result", async (event, ctx) => {
		if ((event.toolName !== "edit" && event.toolName !== "write") || event.isError) return;
		const input = event.input.path;
		if (typeof input !== "string") return;

		const note = await noteFor(resolvePath(input, ctx.cwd));
		if (!note || noted.has(note.key)) return;
		noted.add(note.key);
		return {
			content: [...event.content, { type: "text" as const, text: note.text }],
			structuredContent: event.structuredContent,
		};
	});
}
