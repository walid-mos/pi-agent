// Tests of the footer's git reading: porcelain parsing, and readRepo() against throwaway repositories.
//
// Run: node --test ~/.pi/agent/extensions/footer/

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { parseRemote, parseShortstat, parseStatus, readRepo } from "./git.ts";

test("parseStatus reads branch, upstream, divergence, stash and counts each kind of change", () => {
	const status = parseStatus(
		[
			"# branch.oid 8be1c19aa1b2c3d4e5f60718293a4b5c6d7e8f90",
			"# branch.head main",
			"# branch.upstream origin/main",
			"# branch.ab +2 -1",
			"# stash 3",
			"1 M. N... 100644 100644 100644 aaa bbb staged.ts",
			"1 .M N... 100644 100644 100644 aaa bbb modified.ts",
			"1 MM N... 100644 100644 100644 aaa bbb both.ts",
			"2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
			"u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
			"? untracked.ts",
			"? other.ts",
			"! ignored.ts",
			"",
		].join("\n"),
	);
	assert.deepEqual(status, {
		head: { kind: "branch", name: "main", oid: "8be1c19aa1b2c3d4e5f60718293a4b5c6d7e8f90" },
		upstream: "origin/main",
		ahead: 2,
		behind: 1,
		stash: 3,
		staged: 3,
		modified: 2,
		untracked: 2,
		conflicted: 1,
	});
});

test("parseStatus tells a detached HEAD and a repository without commits apart", () => {
	assert.deepEqual(parseStatus("# branch.oid 1234567890abcdef\n# branch.head (detached)\n").head, {
		kind: "detached",
		oid: "1234567890abcdef",
	});
	assert.deepEqual(parseStatus("# branch.oid (initial)\n# branch.head main\n").head, { kind: "unborn", name: "main" });
});

test("parseStatus leaves upstream out and counts nothing on a clean branch without upstream", () => {
	assert.deepEqual(parseStatus("# branch.oid abc\n# branch.head feat/x\n"), {
		head: { kind: "branch", name: "feat/x", oid: "abc" },
		upstream: undefined,
		ahead: 0,
		behind: 0,
		stash: 0,
		staged: 0,
		modified: 0,
		untracked: 0,
		conflicted: 0,
	});
});

test("parseShortstat reads insertions and deletions, either of which git omits when zero", () => {
	assert.deepEqual(parseShortstat(" 3 files changed, 120 insertions(+), 34 deletions(-)\n"), { insertions: 120, deletions: 34 });
	assert.deepEqual(parseShortstat(" 1 file changed, 1 insertion(+)\n"), { insertions: 1, deletions: 0 });
	assert.deepEqual(parseShortstat(" 1 file changed, 2 deletions(-)\n"), { insertions: 0, deletions: 2 });
	assert.deepEqual(parseShortstat(""), { insertions: 0, deletions: 0 });
});

test("parseRemote gives the host and owner/name of ssh, scp-like and https remotes", () => {
	assert.deepEqual(parseRemote("git@github.com:walid-mos/pi-agent.git"), { host: "github.com", path: "walid-mos/pi-agent" });
	assert.deepEqual(parseRemote("https://github.com/earendil-works/pi"), { host: "github.com", path: "earendil-works/pi" });
	assert.deepEqual(parseRemote("ssh://git@gitlab.example.com:2222/group/sub/repo.git"), {
		host: "gitlab.example.com",
		path: "group/sub/repo",
	});
	assert.equal(parseRemote("/srv/git/local.git"), undefined);
});

let root: string;

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
	});
}

beforeEach(() => {
	// realpath: on macOS the temporary directory is reached through the /var -> /private/var link, git prints the target.
	root = realpathSync(mkdtempSync(join(tmpdir(), "footer-git-")));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

test("readRepo says a directory outside any repository has none", async () => {
	assert.deepEqual(await readRepo(root), { kind: "none" });
});

test("readRepo reads the root, last commit, remote, status and diff size of a repository", async () => {
	const repo = join(root, "my-repo");
	mkdirSync(join(repo, "src"), { recursive: true });
	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "user.email", "t@example.com");
	git(repo, "config", "user.name", "T");
	git(repo, "remote", "add", "origin", "git@github.com:someone/my-repo.git");
	writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
	git(repo, "add", "a.txt");
	git(repo, "commit", "-q", "-m", "feat: first commit");
	writeFileSync(join(repo, "a.txt"), "one\nthree\nfour\n");
	writeFileSync(join(repo, "new.txt"), "x\n");

	const result = await readRepo(join(repo, "src"));

	assert.equal(result.kind, "repo");
	if (result.kind !== "repo") return;
	assert.equal(result.root, repo);
	assert.equal(result.name, "my-repo");
	assert.deepEqual(result.remote, { host: "github.com", path: "someone/my-repo" });
	assert.equal(result.commit?.subject, "feat: first commit");
	assert.match(result.commit?.hash ?? "", /^[0-9a-f]{7,}$/);
	assert.ok(Math.abs((result.commit?.time ?? 0) - Date.now()) < 60_000);
	assert.equal(result.status.head.kind, "branch");
	assert.equal(result.status.modified, 1);
	assert.equal(result.status.untracked, 1);
	assert.deepEqual(result.diff, { insertions: 2, deletions: 1 });
});

test("readRepo reads a repository without commits", async () => {
	git(root, "init", "-q", "-b", "trunk");
	const result = await readRepo(root);
	assert.equal(result.kind, "repo");
	if (result.kind !== "repo") return;
	assert.deepEqual(result.status.head, { kind: "unborn", name: "trunk" });
	assert.equal(result.commit, undefined);
	assert.equal(result.remote, undefined);
});
