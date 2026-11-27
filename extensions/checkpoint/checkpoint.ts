/**
 * Builds one checkpoint: the compaction entry that replaces everything before the verbatim tail.
 *
 * Layout, from the most stable bytes to the least, so that consecutive checkpoints share a cacheable prefix:
 * the frozen chunk stubs (append-only), the ledger (rewritten each pass, by code), the state note (rewritten each
 * pass, by the model). The model is asked for the note only, with the conversation exactly as the session sends it
 * followed by one instruction, so the request reuses the session's prompt cache when the provider allows it.
 */

import type { Api, AssistantMessage, Message, Model, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
	type CompactionEntry,
	convertToLlm,
	estimateTokens,
	type ModelRegistry,
	type SessionEntry,
	type SessionProjection,
} from "@earendil-works/pi-coding-agent";

import type { Thresholds } from "./config.ts";
import { contentText, itemsOf, textTokens } from "./entries.ts";
import { renderLedger, renderStub } from "./ledger.ts";

export type Chunk = { id: string; firstEntryId: string; lastEntryId: string; stub: string };

/** Stored as the compaction entry's `details`; the next pass reads its chunks back from there. */
export type CheckpointDetails = { checkpoint: 1; chunks: Chunk[]; nextChunk: number; note: string };

export type Checkpoint = {
	summary: string;
	firstKeptEntryId: string;
	details: CheckpointDetails;
	usage?: Usage;
	/** Estimated tokens of the context span the checkpoint replaces. */
	tokensReplaced: number;
	/** Estimated tokens of the checkpoint itself. */
	tokensCheckpoint: number;
	/** The branch as it was when the checkpoint was built; applying it on another branch would lose entries. */
	snapshot: { leafId: string | null; compactionId: string | null };
};

export type BuildInput = {
	branch: SessionEntry[];
	projection: SessionProjection;
	leafId: string | null;
	thresholds: Thresholds;
	model: Model<Api>;
	registry: ModelRegistry;
	sessionId: string;
	reasoning: ThinkingLevel | undefined;
	/** "overflow": the context no longer fits the model, so the request itself is pruned hard and the tail kept small. */
	mode: "normal" | "overflow";
	customInstructions?: string;
	repository: string;
	signal: AbortSignal;
};

export class CheckpointError extends Error {}

const SECTIONS = ["## Current request", "## Told to the user", "## Current work", "## Next actions"];
/** Opening words of the instruction: a note that contains them quotes the instruction instead of the conversation. */
const INSTRUCTION_MARK = "[Checkpoint request from the harness, not from the user]";
/** Tool results longer than this are stubbed by pruning (CliffCompaction, 2609.26779). */
export const PRUNE_MIN_CHARS = 500;

export function isCheckpointDetails(details: unknown): details is CheckpointDetails {
	return typeof details === "object" && details !== null && (details as { checkpoint?: unknown }).checkpoint === 1;
}

export function latestCompaction(branch: readonly SessionEntry[]): CompactionEntry | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type === "compaction") return entry;
	}
	return undefined;
}

/** A tail may start at a user or assistant message or an injected message, never at a tool result: a pair is never split. */
function canStartTail(entry: SessionEntry): boolean {
	if (entry.type === "custom_message") return true;
	if (entry.type !== "message") return false;
	const role = (entry.message as { role: string }).role;
	return role === "user" || role === "assistant" || role === "bashExecution" || role === "custom";
}

/** Index in the projection of the first entry kept verbatim: the tail holds at least `tailTokens`. */
export function tailStart(projection: SessionProjection, tailTokens: number): number | undefined {
	let tokens = 0;
	let index = projection.entries.length;
	while (index > 0 && tokens < tailTokens) {
		index--;
		for (const message of projection.entries[index].messages) tokens += estimateTokens(message);
	}
	while (index > 0 && !canStartTail(projection.entries[index].sourceEntry)) index--;
	// Index 0 is the previous checkpoint or the first message: nothing before it to replace.
	return index > 0 ? index : undefined;
}

/** Tokens of the conversation in a span of the projection; the system prompt is kept by a checkpoint, so not counted. */
function projectedTokens(projection: SessionProjection, from: number, to: number): number {
	let tokens = 0;
	for (const entry of projection.entries.slice(from, to)) {
		for (const message of entry.messages) if ((message as { role: string }).role !== "system") tokens += estimateTokens(message);
	}
	return tokens;
}

function chunksAfter(input: BuildInput, cutEntryId: string): { chunks: Chunk[]; nextChunk: number } {
	const { branch, thresholds } = input;
	const previous = latestCompaction(branch);
	const ours = previous && isCheckpointDetails(previous.details) ? previous.details : undefined;
	const cutIndex = branch.findIndex((entry) => entry.id === cutEntryId);
	// A previous checkpoint covered everything before its kept boundary; another compaction (Pi's own) covered
	// nothing this extension can index, so the new chunk then starts at the beginning of the branch.
	const startIndex = ours && previous ? Math.max(0, branch.findIndex((entry) => entry.id === previous.firstKeptEntryId)) : 0;
	let chunks = ours ? [...ours.chunks] : [];
	let nextChunk = ours ? ours.nextChunk : 1;

	const span = branch.slice(startIndex, cutIndex);
	const items = itemsOf(span).filter((item) => item.kind !== "summary");
	if (items.length === 0) throw new CheckpointError("nothing new to checkpoint before the verbatim tail");
	const id = `c${nextChunk++}`;
	chunks.push({ id, firstEntryId: items[0].entryId, lastEntryId: items[items.length - 1].entryId, stub: renderStub(id, items, items[0].entryId, items[items.length - 1].entryId) });

	// Rollup: when the index outgrows its budget, the oldest half is merged and its stub written again from the
	// originals, never from the stubs being merged.
	while (chunks.length > 1 && chunks.reduce((sum, chunk) => sum + textTokens(chunk.stub), 0) > thresholds.rollup) {
		const count = Math.max(2, Math.floor(chunks.length / 2));
		const merged = chunks.slice(0, count);
		const from = branch.findIndex((entry) => entry.id === merged[0].firstEntryId);
		const to = branch.findIndex((entry) => entry.id === merged[merged.length - 1].lastEntryId);
		const mergedItems = itemsOf(branch.slice(from, to + 1)).filter((item) => item.kind !== "summary");
		const firstId = merged[0].id.split("-")[0];
		const lastId = merged[merged.length - 1].id.split("-").pop();
		const rolledId = `${firstId}-${lastId}`;
		const rolled: Chunk = {
			id: rolledId,
			firstEntryId: merged[0].firstEntryId,
			lastEntryId: merged[merged.length - 1].lastEntryId,
			stub: renderStub(rolledId, mergedItems, merged[0].firstEntryId, merged[merged.length - 1].lastEntryId),
		};
		chunks = [rolled, ...chunks.slice(count)];
	}
	return { chunks, nextChunk };
}

function instruction(input: BuildInput): string {
	const lines = [
		INSTRUCTION_MARK,
		"Stop the task for one answer: the conversation is about to be compacted. Everything before the last few messages",
		"will be replaced by a checkpoint, and you will continue from that checkpoint alone. This message is not part of",
		"the task: the user's latest request is the last user message before this one.",
		"Do not continue the task in this answer, even when the message just before this one is a tool result: act on it",
		"after the checkpoint. This answer is the <state> block below and nothing else.",
		"",
		"Code already keeps, copied from the originals: the user's messages verbatim, the files read and changed, the",
		"commands with their exit codes, the exact errors, the repository state and an index of earlier chunks. Do not",
		"repeat those lists. Write the handoff note that they cannot replace, in the first person, as the agent who will",
		"carry on. Do not call any tool. Answer with exactly this block and nothing else:",
		"",
		"<state>",
		"## Current request",
		"The user's latest request (the last user message before this one) quoted word for word, then any earlier request",
		"still open, then the constraints and preferences of the user that still apply.",
		"## Told to the user",
		"What you have already reported, promised or asked the user, so that you neither repeat nor contradict it.",
		"## Current work",
		"What you were doing; the decisions taken and why; what was tried and failed; the exact values, names and paths",
		"that matter.",
		"## Next actions",
		"The next steps in order, down to the exact command, or the file and the place in it, to start from.",
		"</state>",
		"",
		`Keep the note under ${input.thresholds.noteTokens} tokens.`,
	];
	if (input.customInstructions?.trim()) lines.push("", `The user asks for this compaction: ${input.customInstructions.trim()}`);
	return lines.join("\n");
}

/** For overflow recovery: every long tool result except the latest ones is stubbed in the request, which must fit. */
function prunedForOverflow(messages: Message[]): Message[] {
	const keepFrom = Math.max(0, messages.length - 2);
	return messages.map((message, index) => {
		if (index >= keepFrom || message.role !== "toolResult") return message;
		const text = contentText(message.content);
		if (text.length <= PRUNE_MIN_CHARS) return message;
		return { ...message, content: [{ type: "text", text: `[${text.length} chars left out to fit the context]` }] };
	});
}

function addUsage(total: Usage | undefined, next: Usage): Usage {
	if (!total) return next;
	return {
		...next,
		input: total.input + next.input,
		output: total.output + next.output,
		cacheRead: total.cacheRead + next.cacheRead,
		cacheWrite: total.cacheWrite + next.cacheWrite,
		totalTokens: total.totalTokens + next.totalTokens,
		cost: {
			...next.cost,
			input: total.cost.input + next.cost.input,
			output: total.cost.output + next.cost.output,
			cacheRead: total.cost.cacheRead + next.cost.cacheRead,
			cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
			total: total.cost.total + next.cost.total,
			totalFromProvider: total.cost.totalFromProvider === true && next.cost.totalFromProvider === true,
		},
	};
}

async function ask(input: BuildInput, messages: Message[]): Promise<AssistantMessage> {
	const stream = input.registry.streamSimple(
		input.model,
		{ messages },
		{
			signal: input.signal,
			sessionId: input.sessionId,
			reasoning: input.reasoning,
			toolChoice: "none",
			// Room for the note and for the model's reasoning; a note cut by this cap is rejected, not used.
			maxTokens: Math.min(input.model.maxTokens, input.thresholds.noteTokens + 32_000),
			// A replay: it must not replace the server-side state of the real conversation.
			disableContinuation: true,
		},
	);
	const answer = await stream.result();
	if (answer.stopReason === "error" || answer.stopReason === "aborted") {
		throw new CheckpointError(`the checkpoint request ${answer.stopReason === "aborted" ? "was aborted" : `failed: ${answer.errorMessage ?? "no error message"}`}`);
	}
	if (answer.stopReason === "length") throw new CheckpointError("the state note hit the output cap (truncated notes are rejected)");
	return answer;
}

/** The last <state> block of the answer: a model that first echoes the template then writes the note is read right. */
function stateBlock(answer: string): string | undefined {
	const open = answer.lastIndexOf("<state>");
	if (open < 0) return undefined;
	const close = answer.indexOf("</state>", open);
	return close < 0 ? undefined : answer.slice(open + "<state>".length, close).trim();
}

/** What is wrong with a note: a missing block or section, an empty section, or the instruction quoted back. */
function noteProblems(note: string | undefined): string[] {
	if (note === undefined) return ["the <state> block"];
	if (note.includes(INSTRUCTION_MARK) || note.includes("Stop the task for one answer")) {
		return ["a note about the conversation (it quotes the checkpoint instruction instead)"];
	}
	const problems: string[] = [];
	for (const [index, section] of SECTIONS.entries()) {
		const at = note.indexOf(section);
		if (at < 0) {
			problems.push(`the section "${section}"`);
			continue;
		}
		const next = SECTIONS.slice(index + 1).map((later) => note.indexOf(later)).find((position) => position > at);
		if (!note.slice(at + section.length, next ?? note.length).trim()) problems.push(`content under "${section}"`);
	}
	return problems;
}

/** Writes the state note, allowing one reminder when a section is missing. */
async function writeNote(input: BuildInput, messages: Message[]): Promise<{ note: string; usage?: Usage }> {
	const request: Message[] = [...messages, { role: "user", content: [{ type: "text", text: instruction(input) }], timestamp: Date.now() }];
	let answer = await ask(input, request);
	let usage = answer.usage;
	let note = stateBlock(contentText(answer.content));
	let missing = noteProblems(note);
	if (missing.length > 0) {
		const reminder = `${INSTRUCTION_MARK} Your answer lacks ${missing.join(", ")}. Write the whole <state> block again, about the conversation before my previous message, with every section filled.`;
		answer = await ask(input, [...request, answer, { role: "user", content: [{ type: "text", text: reminder }], timestamp: Date.now() }]);
		usage = addUsage(usage, answer.usage);
		note = stateBlock(contentText(answer.content));
		missing = noteProblems(note);
		if (missing.length > 0) {
			const began = contentText(answer.content).replace(/\s+/g, " ").slice(0, 240);
			throw new CheckpointError(`the state note lacks ${missing.join(", ")} after one reminder; the answer began: «${began}» (stop: ${answer.stopReason})`);
		}
	}
	return { note: note as string, usage };
}

export function renderCheckpoint(chunks: readonly Chunk[], ledger: string, note: string): string {
	return [
		"<checkpoint>",
		"This checkpoint replaces the conversation before the messages that follow it. Carry on from its state note; do not",
		"start the task over. The original entries are still readable with history_read (by chunk or entry id) and",
		"history_search.",
		"",
		"<chunks>",
		chunks.map((chunk) => chunk.stub).join("\n\n"),
		"</chunks>",
		"",
		"<ledger>",
		ledger,
		"</ledger>",
		"",
		"<state>",
		note,
		"</state>",
		"</checkpoint>",
	].join("\n");
}

/**
 * Tokens a checkpoint built now could replace: the conversation before the verbatim tail, minus the previous
 * checkpoint it would rewrite. The system prompt is kept by every checkpoint, so it never counts.
 */
export function replaceableTokens(projection: SessionProjection, tailTokens: number): number {
	const cut = tailStart(projection, tailTokens);
	if (cut === undefined) return 0;
	let previous = 0;
	const first = projection.entries[0];
	if (first?.sourceEntry.type === "compaction") previous = projectedTokens(projection, 0, 1);
	return projectedTokens(projection, 0, cut) - previous;
}

/**
 * Why a checkpoint is not worth writing now, checked by code before any model call: one that frees less than a
 * pruning step costs a model call and a cache break for nothing. At the ceiling it means the system prompt and the
 * verbatim tail alone fill it. Overflow is exempt: there any reduction is needed.
 */
export function tooLittleToReplace(projection: SessionProjection, thresholds: Thresholds): string | undefined {
	const replaceable = replaceableTokens(projection, thresholds.tail);
	if (replaceable >= thresholds.pruneStep) return undefined;
	return `only about ${replaceable} tokens of conversation lie before the verbatim tail, less than the ${thresholds.pruneStep} a checkpoint must free; if the context stays past the ${thresholds.ceiling}-token ceiling, the system prompt and the tail fill it: raise it with /ceiling`;
}

export async function buildCheckpoint(input: BuildInput): Promise<Checkpoint> {
	const { projection, branch } = input;
	const tail = input.mode === "overflow" ? Math.round(input.thresholds.tail / 3) : input.thresholds.tail;
	const tooLittle = input.mode === "overflow" ? undefined : tooLittleToReplace(projection, input.thresholds);
	if (tooLittle) throw new CheckpointError(tooLittle);
	const cut = tailStart(projection, tail);
	if (cut === undefined) throw new CheckpointError("the whole context fits in the verbatim tail; nothing to checkpoint");
	const firstKeptEntryId = projection.entries[cut].sourceEntry.id;
	const tokensReplaced = projectedTokens(projection, 0, cut);

	const { chunks, nextChunk } = chunksAfter(input, firstKeptEntryId);
	const cutIndex = branch.findIndex((entry) => entry.id === firstKeptEntryId);
	const ledger = renderLedger(itemsOf(branch.slice(0, cutIndex)), input.thresholds.ledgerTokens, input.repository);

	const llm = convertToLlm(projection.messages);
	const { note, usage } = await writeNote(input, input.mode === "overflow" ? prunedForOverflow(llm) : llm);

	const summary = renderCheckpoint(chunks, ledger, note);
	const tokensCheckpoint = textTokens(summary);
	if (tokensCheckpoint >= tokensReplaced) {
		throw new CheckpointError(`the checkpoint (${tokensCheckpoint} tokens) is not smaller than what it replaces (${tokensReplaced} tokens)`);
	}
	return {
		summary,
		firstKeptEntryId,
		details: { checkpoint: 1, chunks, nextChunk, note },
		usage,
		tokensReplaced,
		tokensCheckpoint,
		snapshot: { leafId: input.leafId, compactionId: latestCompaction(branch)?.id ?? null },
	};
}

/**
 * Context size once the checkpoint is applied to the projection as it is now, in the unit of `contextTokens` (the
 * provider's count). The span replaced is measured now, since pruning may have shrunk it after the build, and Pi's
 * estimate is scaled by the provider's count of the same context: the two differ by a model-dependent factor.
 * Undefined when the checkpoint's first kept entry is not in the projection.
 */
export function tokensAfter(checkpoint: Checkpoint, projection: SessionProjection, contextTokens: number): number | undefined {
	const cut = projection.entries.findIndex((entry) => entry.sourceEntry.id === checkpoint.firstKeptEntryId);
	if (cut < 0) return undefined;
	let estimated = 0;
	for (const message of projection.messages) estimated += estimateTokens(message);
	if (estimated === 0) return undefined;
	const after = estimated - projectedTokens(projection, 0, cut) + checkpoint.tokensCheckpoint;
	return Math.round((after * contextTokens) / estimated);
}

/** Whether a checkpoint built earlier can still be applied to the branch as it is now. */
export function stillApplies(checkpoint: Checkpoint, branch: readonly SessionEntry[]): string | undefined {
	if ((latestCompaction(branch)?.id ?? null) !== checkpoint.snapshot.compactionId) return "another compaction was committed since it was built";
	const ids = new Set(branch.map((entry) => entry.id));
	if (checkpoint.snapshot.leafId && !ids.has(checkpoint.snapshot.leafId)) return "the branch changed since it was built (/tree or a fork)";
	if (!ids.has(checkpoint.firstKeptEntryId)) return "its first kept entry is no longer on the branch";
	return undefined;
}
