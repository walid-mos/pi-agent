/**
 * Recall: history_read and history_search read the original entries of the branch back, in full, including those a
 * checkpoint replaced and the tool results pruning stubbed. A checkpoint can then stay small without losing anything.
 */

import { Type } from "typebox";
import { defineTool, type SessionEntry } from "@earendil-works/pi-coding-agent";

import { isCheckpointDetails, latestCompaction } from "./checkpoint.ts";
import { itemOf, itemsOf, serializeItem } from "./entries.ts";

const DEFAULT_MAX_CHARS = 20_000;
const HARD_MAX_CHARS = 100_000;

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: undefined };
}

/** The range of one chunk, from the index of the latest checkpoint on the branch. */
function chunkRange(branch: readonly SessionEntry[], chunkId: string): { from: string; to: string } | string {
	const details = latestCompaction(branch)?.details;
	if (!isCheckpointDetails(details)) return "there is no checkpoint on this branch, so no chunk ids";
	const chunk = details.chunks.find((candidate) => candidate.id === chunkId);
	if (!chunk) return `no chunk ${chunkId}; chunks on this branch: ${details.chunks.map((candidate) => candidate.id).join(", ")}`;
	return { from: chunk.firstEntryId, to: chunk.lastEntryId };
}

export const historyRead = defineTool({
	name: "history_read",
	label: "History read",
	description:
		"Read original session entries in full: a chunk of a checkpoint (chunk=c3), one entry (entry=<id>), or a range " +
		"(from=<id>, to=<id>). Entry ids appear in checkpoints, in pruned tool results and in history_search results.",
	promptSnippet: "history_read: read original conversation entries that a checkpoint replaced or pruning stubbed",
	promptGuidelines: [
		"After a checkpoint, carry on from its state note: do not start the task over. When an exact detail it does not hold matters, read it back with history_read or find it with history_search instead of guessing or redoing the work.",
	],
	parameters: Type.Object({
		chunk: Type.Optional(Type.String({ description: "Chunk id from the checkpoint, e.g. c3 or c1-c4" })),
		entry: Type.Optional(Type.String({ description: "One entry id" })),
		from: Type.Optional(Type.String({ description: "First entry id of a range" })),
		to: Type.Optional(Type.String({ description: "Last entry id of a range (inclusive)" })),
		offset: Type.Optional(Type.Number({ description: "Characters to skip, to continue a cut answer" })),
		maxChars: Type.Optional(Type.Number({ description: `Characters to return (default ${DEFAULT_MAX_CHARS}, max ${HARD_MAX_CHARS})` })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const branch = ctx.sessionManager.getBranch();
		let from = params.from;
		let to = params.to;
		if (params.chunk) {
			const range = chunkRange(branch, params.chunk);
			if (typeof range === "string") throw new Error(range);
			({ from, to } = range);
		}
		if (params.entry) from = to = params.entry;
		if (!from) throw new Error("give chunk, entry, or from (with an optional to)");
		const start = branch.findIndex((entry) => entry.id === from);
		if (start < 0) throw new Error(`entry ${from} is not on the current branch`);
		const end = to ? branch.findIndex((entry) => entry.id === to) : start;
		if (end < 0) throw new Error(`entry ${to} is not on the current branch`);
		if (end < start) throw new Error(`entry ${to} comes before ${from}`);

		const all = itemsOf(branch.slice(start, end + 1)).map(serializeItem).join("\n\n");
		const offset = Math.max(0, Math.floor(params.offset ?? 0));
		const max = Math.min(HARD_MAX_CHARS, Math.max(1_000, Math.floor(params.maxChars ?? DEFAULT_MAX_CHARS)));
		const part = all.slice(offset, offset + max);
		const rest = all.length - offset - part.length;
		return text(rest > 0 ? `${part}\n\n[${rest} more chars: call again with offset=${offset + part.length}]` : part || "(no conversation entries in this range)");
	},
});

export const historySearch = defineTool({
	name: "history_search",
	label: "History search",
	description:
		"Search the original entries of this session's branch, including those replaced by a checkpoint or pruned. " +
		"Returns matching entry ids with a snippet; read one in full with history_read.",
	parameters: Type.Object({
		pattern: Type.String({ description: "Text to find (case-insensitive), or a regular expression when regex is true" }),
		regex: Type.Optional(Type.Boolean({ description: "Treat pattern as a JavaScript regular expression" })),
		limit: Type.Optional(Type.Number({ description: "Maximum matches (default 20)" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const matcher = params.regex ? new RegExp(params.pattern, "i") : undefined;
		const needle = params.pattern.toLowerCase();
		const limit = Math.max(1, Math.floor(params.limit ?? 20));
		const hits: string[] = [];
		let total = 0;
		for (const entry of ctx.sessionManager.getBranch()) {
			const item = itemOf(entry);
			if (!item) continue;
			const body = serializeItem(item);
			const at = matcher ? body.search(matcher) : body.toLowerCase().indexOf(needle);
			if (at < 0) continue;
			total++;
			if (hits.length < limit) {
				const snippet = body.slice(Math.max(0, at - 120), at + 200).replace(/\s+/g, " ");
				hits.push(`- ${entry.id} (${item.kind}, ${entry.timestamp}): …${snippet}…`);
			}
		}
		if (total === 0) return text(`No entry matches ${JSON.stringify(params.pattern)}.`);
		return text(`${total} entries match${total > hits.length ? `; first ${hits.length} shown` : ""}:\n${hits.join("\n")}`);
	},
});
