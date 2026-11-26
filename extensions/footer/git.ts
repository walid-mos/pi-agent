/**
 * What the footer shows of the repository Pi works in: root, branch, divergence from upstream, changes, stash, last
 * commit, remote and size of the uncommitted diff. Read with a few `git` calls; nothing is written, and
 * `--no-optional-locks` keeps them from taking the index lock that the user's own git commands need.
 */

import { execFile } from "node:child_process";
import { basename } from "node:path";

// git answers in milliseconds on an ordinary repository; past this it is stuck on a lock or a huge worktree.
const TIMEOUT_MS = 8_000;

export type Head =
	| { kind: "branch"; name: string; oid: string }
	| { kind: "detached"; oid: string }
	| { kind: "unborn"; name: string }; // `git init` done, no commit yet

export type Status = {
	head: Head;
	upstream: string | undefined;
	ahead: number;
	behind: number;
	stash: number;
	staged: number;
	modified: number;
	untracked: number;
	conflicted: number;
};

export type Diff = { insertions: number; deletions: number };
export type Remote = { host: string; path: string };
export type Commit = { hash: string; subject: string; time: number };

export type Repo =
	| { kind: "none" } // the directory is in no repository
	| {
			kind: "repo";
			root: string;
			name: string;
			status: Status;
			commit: Commit | undefined;
			remote: Remote | undefined;
			diff: Diff;
	  };

/** Parses `git status --porcelain=v2 --branch --show-stash`. */
export function parseStatus(text: string): Status {
	let oid = "";
	let headName = "";
	const status: Omit<Status, "head"> = {
		upstream: undefined,
		ahead: 0,
		behind: 0,
		stash: 0,
		staged: 0,
		modified: 0,
		untracked: 0,
		conflicted: 0,
	};
	for (const line of text.split("\n")) {
		if (line.startsWith("# branch.oid ")) oid = line.slice("# branch.oid ".length);
		else if (line.startsWith("# branch.head ")) headName = line.slice("# branch.head ".length);
		else if (line.startsWith("# branch.upstream ")) status.upstream = line.slice("# branch.upstream ".length);
		else if (line.startsWith("# branch.ab ")) {
			const match = /^\+(\d+) -(\d+)$/.exec(line.slice("# branch.ab ".length));
			if (match) {
				status.ahead = Number(match[1]);
				status.behind = Number(match[2]);
			}
		} else if (line.startsWith("# stash ")) status.stash = Number(line.slice("# stash ".length));
		else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			const [index, worktree] = line.slice(2, 4);
			if (index !== ".") status.staged++;
			if (worktree !== ".") status.modified++;
		} else if (line.startsWith("u ")) status.conflicted++;
		else if (line.startsWith("? ")) status.untracked++;
	}
	const head: Head =
		oid === "(initial)"
			? { kind: "unborn", name: headName }
			: headName === "(detached)"
				? { kind: "detached", oid }
				: { kind: "branch", name: headName, oid };
	return { head, ...status };
}

/** Parses `git diff --shortstat`, which omits insertions or deletions when there are none. */
export function parseShortstat(text: string): Diff {
	return {
		insertions: Number(/(\d+) insertions?\(\+\)/.exec(text)?.[1] ?? 0),
		deletions: Number(/(\d+) deletions?\(-\)/.exec(text)?.[1] ?? 0),
	};
}

/** The host and `owner/name` path of a network remote; a local path has neither. */
export function parseRemote(url: string): Remote | undefined {
	const match =
		/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(url) ?? // ssh://, https://
		/^(?:[^@/]+@)?([^/:]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(url); // scp-like: git@host:owner/name
	return match ? { host: match[1], path: match[2] } : undefined;
}

type GitResult = { code: number; stdout: string; stderr: string };

/** Runs git; a non-zero exit is returned for the caller to judge, a git that cannot run at all is thrown. */
function git(cwd: string, args: string[]): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		execFile("git", ["--no-optional-locks", ...args], { cwd, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
			if (!error) return resolve({ code: 0, stdout, stderr });
			if (typeof error.code === "number" && !error.killed) return resolve({ code: error.code, stdout, stderr });
			reject(new Error(`git ${args[0]}: ${error.killed ? `no answer after ${TIMEOUT_MS} ms` : error.message}`));
		});
	});
}

/** The output of a git call that must succeed. */
async function required(cwd: string, args: string[]): Promise<string> {
	const result = await git(cwd, args);
	if (result.code !== 0) throw new Error(`git ${args[0]}: ${result.stderr.trim() || `exit ${result.code}`}`);
	return result.stdout;
}

function pickRemote(remotes: string): Remote | undefined {
	const fetchUrls = remotes
		.split("\n")
		.map((line) => /^(\S+)\t(\S+) \(fetch\)$/.exec(line))
		.filter((match) => match !== null);
	const chosen = fetchUrls.find((match) => match[1] === "origin") ?? fetchUrls[0];
	return chosen ? parseRemote(chosen[2]) : undefined;
}

/** Reads the repository containing `cwd`. Throws when git fails for any reason other than there being no repository. */
export async function readRepo(cwd: string): Promise<Repo> {
	const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
	if (top.code !== 0) {
		if (/not a git repository/i.test(top.stderr)) return { kind: "none" };
		throw new Error(`git rev-parse: ${top.stderr.trim() || `exit ${top.code}`}`);
	}
	const root = top.stdout.trim();
	const [statusText, remotes] = await Promise.all([
		required(root, ["status", "--porcelain=v2", "--branch", "--show-stash"]),
		required(root, ["remote", "-v"]),
	]);
	const status = parseStatus(statusText);
	let commit: Commit | undefined;
	let diff: Diff = { insertions: 0, deletions: 0 };
	if (status.head.kind !== "unborn") {
		const [log, shortstat] = await Promise.all([
			required(root, ["log", "-1", "--format=%h%x1f%ct%x1f%s"]),
			required(root, ["diff", "--shortstat", "HEAD"]),
		]);
		const [hash, seconds, subject] = log.trimEnd().split("\x1f");
		commit = { hash, subject, time: Number(seconds) * 1000 };
		diff = parseShortstat(shortstat);
	}
	return { kind: "repo", root, name: basename(root), status, commit, remote: pickRemote(remotes), diff };
}
