/**
 * Pruning: old long tool results are replaced in the model's context by a one-line stub, by code, with no model call.
 *
 * Tool results are most of an agent's context (56 % in CliffCompaction, 2609.26779), and masking old ones matches a
 * model summary at a fraction of the cost (The Complexity Trap, 2508.21433). Each stub is a `context_edit` entry:
 * the original stays in the session, Pi renders the same bytes on every later request, and history_read reads the
 * original back. The assistant's tool call is not touched, so the model still sees what it asked for.
 *
 * Every edit breaks the prompt cache from the edited point on, so stubs are written in batches (CADOC, 2609.37012).
 */

import type { ContextEditEntryDraft, SessionProjection } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";

import { PRUNE_MIN_CHARS } from "./checkpoint.ts";
import { CHARS_PER_TOKEN, clip, contentText } from "./entries.ts";

const STUB_MARK = "[pruned ";
/** Errors are worth more than other output: one is stubbed only when it is very long. */
const PRUNE_MIN_ERROR_CHARS = 4_000;

export type PruneBatch = { drafts: ContextEditEntryDraft[]; savedTokens: number };

/** Index of the first projected entry inside the verbatim tail, which pruning never touches. */
function tailIndex(projection: SessionProjection, tailTokens: number): number {
	let tokens = 0;
	let index = projection.entries.length;
	while (index > 0 && tokens < tailTokens) {
		index--;
		for (const message of projection.entries[index].messages) tokens += estimateTokens(message);
	}
	return index;
}

export function pruneBatch(projection: SessionProjection, tailTokens: number): PruneBatch {
	const drafts: ContextEditEntryDraft[] = [];
	let savedChars = 0;
	const end = tailIndex(projection, tailTokens);
	for (const { sourceEntry, messages } of projection.entries.slice(0, end)) {
		if (sourceEntry.type !== "message" || messages.length !== 1) continue;
		const message = messages[0] as unknown as { role: string; toolName?: string; isError?: boolean; content: unknown };
		if (message.role !== "toolResult") continue;
		const text = contentText(message.content);
		if (text.startsWith(STUB_MARK)) continue;
		const hasImage = Array.isArray(message.content) && message.content.some((block: { type: string }) => block.type === "image");
		const min = message.isError ? PRUNE_MIN_ERROR_CHARS : PRUNE_MIN_CHARS;
		if (text.length <= min && !hasImage) continue;
		const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
		const stub = `${STUB_MARK}${message.toolName ?? "tool"} result: ${text.length} chars${message.isError ? ", error" : ""}${hasImage ? ", with images" : ""}. First line: ${clip(firstLine, 160)} · history_read entry=${sourceEntry.id}]`;
		drafts.push({ type: "context_edit", targetId: sourceEntry.id, replacement: { content: [{ type: "text", text: stub }] } });
		savedChars += text.length - stub.length;
	}
	return { drafts, savedTokens: Math.max(0, Math.round(savedChars / CHARS_PER_TOKEN)) };
}
