/**
 * The original session entries, read into one simple shape.
 *
 * Everything the extension writes by code (the ledger, the chunk stubs, what the recall tools return) is read from
 * the raw entries of the branch, never from what the model currently sees: a pruned tool result or a checkpointed
 * span is still there in full, so nothing is ever summarized from a summary.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

type Block = {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type Item =
	| { kind: "user"; entryId: string; time: string; text: string }
	| { kind: "assistant"; entryId: string; time: string; text: string; calls: ToolCall[] }
	| { kind: "result"; entryId: string; time: string; callId: string; tool: string; text: string; isError: boolean }
	| { kind: "shell"; entryId: string; time: string; command: string; output: string; exitCode: number | undefined }
	| { kind: "custom"; entryId: string; time: string; customType: string; text: string }
	| { kind: "summary"; entryId: string; time: string; text: string };

/** Text of a message content; images become a marker, thinking is left out. */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return (content as Block[])
		.map((block) => (block.type === "text" ? (block.text ?? "") : block.type === "image" ? "[image]" : ""))
		.filter(Boolean)
		.join("\n");
}

/** One raw entry as an item; undefined for entries that carry no conversation (settings, labels, edits, system). */
export function itemOf(entry: SessionEntry): Item | undefined {
	const base = { entryId: entry.id, time: entry.timestamp };
	switch (entry.type) {
		case "message": {
			const message = entry.message as unknown as Record<string, unknown>;
			switch (message.role) {
				case "user":
					return { ...base, kind: "user", text: contentText(message.content) };
				case "assistant": {
					const blocks = Array.isArray(message.content) ? (message.content as Block[]) : [];
					const calls = blocks
						.filter((block) => block.type === "toolCall")
						.map((block) => ({ id: block.id ?? "", name: block.name ?? "", args: block.arguments ?? {} }));
					return { ...base, kind: "assistant", text: contentText(message.content), calls };
				}
				case "toolResult":
					return {
						...base,
						kind: "result",
						callId: String(message.toolCallId ?? ""),
						tool: String(message.toolName ?? ""),
						text: contentText(message.content),
						isError: message.isError === true,
					};
				case "bashExecution":
					return {
						...base,
						kind: "shell",
						command: String(message.command ?? ""),
						output: String(message.output ?? ""),
						exitCode: typeof message.exitCode === "number" ? message.exitCode : undefined,
					};
				case "custom":
					return { ...base, kind: "custom", customType: String(message.customType), text: contentText(message.content) };
				default:
					return undefined;
			}
		}
		case "custom_message":
			return { ...base, kind: "custom", customType: entry.customType, text: contentText(entry.content) };
		case "compaction":
		case "branch_summary":
			return { ...base, kind: "summary", text: entry.summary };
		default:
			return undefined;
	}
}

export function itemsOf(entries: readonly SessionEntry[]): Item[] {
	return entries.map(itemOf).filter((item): item is Item => item !== undefined);
}

/** The item as plain text, in full, for the recall tools. */
export function serializeItem(item: Item): string {
	switch (item.kind) {
		case "user":
			return `[${item.entryId} user ${item.time}]\n${item.text}`;
		case "assistant": {
			const calls = item.calls.map((call) => `→ ${call.name}(${JSON.stringify(call.args)}) [call ${call.id}]`);
			return [`[${item.entryId} assistant ${item.time}]`, item.text, ...calls].filter(Boolean).join("\n");
		}
		case "result":
			return `[${item.entryId} result of ${item.tool}, call ${item.callId}${item.isError ? ", error" : ""}]\n${item.text}`;
		case "shell":
			return `[${item.entryId} user shell, exit ${item.exitCode ?? "?"}]\n$ ${item.command}\n${item.output}`;
		case "custom":
			return `[${item.entryId} ${item.customType}]\n${item.text}`;
		case "summary":
			return `[${item.entryId} summary]\n${item.text}`;
	}
}

/** "2026-11-27T10:02:31.123Z" → "2026-11-27 10:02Z". */
export function shortTime(iso: string): string {
	return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z` : iso;
}

/** Cuts text to a number of characters, saying how much was cut. */
export function clip(text: string, max: number): string {
	const flat = text.trim();
	if (flat.length <= max) return flat;
	return `${flat.slice(0, Math.max(0, max - 24))}… [${flat.length - max + 24} chars cut]`;
}

/** Characters per token, the estimate Pi itself uses for text. */
export const CHARS_PER_TOKEN = 4;

export function textTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}
