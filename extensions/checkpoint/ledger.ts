/**
 * What a checkpoint holds that code, not the model, writes: the ledger and the chunk stubs.
 *
 * Mechanical extraction keeps far more of the exact details (paths, commands, error strings, the user's own words)
 * than a model's summary does (Compact-Bench, 2610.31710), so the model writes only the state note and everything
 * that can be copied is copied here from the original entries.
 */

import { CHARS_PER_TOKEN, clip, type Item, shortTime, type ToolCall } from "./entries.ts";

/** Tools whose path argument is a file read, and tools whose path argument is a file changed. */
const READ_TOOLS = new Set(["read"]);
const WRITE_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash"]);

type Command = { entryId: string; command: string; exitCode: number | undefined; tail: string };
type ErrorLine = { entryId: string; text: string };

type Facts = {
	users: Extract<Item, { kind: "user" }>[];
	read: string[];
	modified: string[];
	commands: Command[];
	errors: ErrorLine[];
};

function exitCodeOf(text: string): number | undefined {
	const match = text.match(/Command exited with code (\d+)/);
	return match ? Number(match[1]) : undefined;
}

/** Last lines of a failed command's output, without Pi's exit-code line. */
function failureTail(text: string): string {
	const lines = text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line && !/^Command exited with code \d+$/.test(line));
	return lines.slice(-3).join(" ⏎ ");
}

/** Moves a value to the end of a list of distinct values, so the list ends with the most recent ones. */
function touch(list: string[], value: string): void {
	const index = list.indexOf(value);
	if (index >= 0) list.splice(index, 1);
	list.push(value);
}

function factsOf(items: readonly Item[]): Facts {
	const calls = new Map<string, ToolCall>();
	const facts: Facts = { users: [], read: [], modified: [], commands: [], errors: [] };
	for (const item of items) {
		switch (item.kind) {
			case "user":
				facts.users.push(item);
				break;
			case "assistant":
				for (const call of item.calls) calls.set(call.id, call);
				break;
			case "shell":
				facts.commands.push({ entryId: item.entryId, command: item.command, exitCode: item.exitCode, tail: "" });
				if (item.exitCode !== 0 && item.exitCode !== undefined) {
					facts.errors.push({ entryId: item.entryId, text: `$ ${item.command} → exit ${item.exitCode}: ${failureTail(item.output)}` });
				}
				break;
			case "result": {
				const call = calls.get(item.callId);
				const path = typeof call?.args.path === "string" ? call.args.path : undefined;
				if (path && !item.isError && READ_TOOLS.has(item.tool)) touch(facts.read, path);
				if (path && !item.isError && WRITE_TOOLS.has(item.tool)) touch(facts.modified, path);
				if (SHELL_TOOLS.has(item.tool) && typeof call?.args.command === "string") {
					const exitCode = exitCodeOf(item.text) ?? (item.isError ? undefined : 0);
					const failed = exitCode !== 0;
					facts.commands.push({ entryId: item.entryId, command: call.args.command, exitCode, tail: failed ? failureTail(item.text) : "" });
					if (failed) facts.errors.push({ entryId: item.entryId, text: `$ ${clip(call.args.command, 200)} → exit ${exitCode ?? "?"}: ${failureTail(item.text)}` });
				} else if (item.isError) {
					facts.errors.push({ entryId: item.entryId, text: `${item.tool}${path ? ` ${path}` : ""}: ${clip(item.text, 400)}` });
				}
				break;
			}
			default:
				break;
		}
	}
	return facts;
}

/** Lines in order until a character budget runs out, then one line saying how many were left out and how to find them. */
function within(lines: string[], budget: number, leftOut: (count: number) => string): string[] {
	const out: string[] = [];
	let used = 0;
	for (const [index, line] of lines.entries()) {
		if (used + line.length > budget && out.length > 0) {
			out.push(leftOut(lines.length - index));
			break;
		}
		out.push(line);
		used += line.length + 1;
	}
	return out;
}

/**
 * The ledger of the span a checkpoint replaces: the user's messages verbatim (newest first), files read and changed,
 * commands with their exit codes, exact error strings, and the repository state at the time of the checkpoint.
 */
export function renderLedger(items: readonly Item[], ledgerTokens: number, repository: string): string {
	const budget = ledgerTokens * CHARS_PER_TOKEN;
	const facts = factsOf(items);

	// The newest request may take half of the user budget; older ones fill what is left.
	const userBudget = budget * 0.5;
	const users = [...facts.users].reverse().map((user, index) => {
		const cap = index === 0 ? userBudget / 2 : Math.min(4_000, userBudget / 4);
		const text = user.text.length > cap ? `${clip(user.text, cap)} (history_read entry=${user.entryId})` : user.text.trim();
		return `[${user.entryId} · ${shortTime(user.time)}]\n${text}`;
	});
	const commands = [...facts.commands]
		.reverse()
		.map((command) => `- \`${clip(command.command, 300)}\` → exit ${command.exitCode ?? "?"} [${command.entryId}]`);
	const errors = [...facts.errors].reverse().map((error) => `- [${error.entryId}] ${error.text}`);
	const modified = [...facts.modified].reverse();
	const read = [...facts.read].reverse().filter((path) => !facts.modified.includes(path));

	const sections = [
		"## User messages (verbatim, newest first)",
		...(users.length ? within(users, userBudget, (n) => `(${n} older user messages left out; history_search finds them)`) : ["(none)"]),
		"",
		"## Files",
		`Changed (newest first; re-read one before editing it again): ${within(modified, budget * 0.05, (n) => `+${n} more`).join(", ") || "(none)"}`,
		`Read: ${within(read, budget * 0.05, (n) => `+${n} more`).join(", ") || "(none)"}`,
		"",
		"## Commands (newest first)",
		...(commands.length ? within(commands, budget * 0.2, (n) => `(${n} older commands left out)`) : ["(none)"]),
		"",
		"## Errors (newest first, exact text)",
		...(errors.length ? within(errors, budget * 0.18, (n) => `(${n} older errors left out)`) : ["(none)"]),
		"",
		"## Repository at checkpoint time",
		repository,
	];
	return sections.join("\n");
}

/** Character cap of one chunk stub, about 300 tokens. */
const STUB_CHARS = 1_200;

/**
 * The frozen stub of one chunk of history: where it is, what was asked, what changed, what failed. Written once by
 * code from the originals and never changed, so every later checkpoint starts with the same bytes.
 */
export function renderStub(id: string, items: readonly Item[], firstEntryId: string, lastEntryId: string): string {
	const facts = factsOf(items);
	const first = items[0]?.time ?? "";
	const last = items[items.length - 1]?.time ?? "";
	const failed = facts.commands.filter((command) => command.exitCode !== 0);
	const lines = [
		`[${id} · ${shortTime(first)} → ${shortTime(last)} · ${items.length} entries · ${firstEntryId}…${lastEntryId} · history_read chunk=${id}]`,
		facts.users.length
			? `Asked: ${facts.users
					.slice(0, 3)
					.map((user) => `«${clip(user.text.replace(/\s+/g, " "), 200)}»`)
					.join(" · ")}${facts.users.length > 3 ? ` (+${facts.users.length - 3} more)` : ""}`
			: "",
		facts.modified.length
			? `Changed: ${facts.modified.slice(-8).join(", ")}${facts.modified.length > 8 ? ` (+${facts.modified.length - 8} more)` : ""}`
			: "",
		facts.commands.length
			? `Ran ${facts.commands.length} commands, ${failed.length} failed${failed.length ? `: ${failed
					.slice(-3)
					.map((command) => `\`${clip(command.command, 80)}\` (exit ${command.exitCode ?? "?"})`)
					.join("; ")}` : ""}`
			: "",
		facts.errors.length ? `Last error: ${clip(facts.errors[facts.errors.length - 1].text, 240)}` : "",
	];
	return clip(lines.filter(Boolean).join("\n"), STUB_CHARS);
}
