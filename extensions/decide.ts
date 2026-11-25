/**
 * decide — a Pi tool that answers a closed question with Jev (System One) through the Magpie gateway.
 *
 * The agent settles a choice, a yes/no check or a rating without spending an LLM turn: picking a tool,
 * sorting items, or a guard before a destructive action. Jev is asked at `group/decide`.
 *
 * Uses the `magpie` provider configured in Pi (models.json for the address, auth.json for the key): the
 * address and key come from Pi's model registry. No other network call, no file read or written, no dependency.
 *
 * Jev API: https://docs.typesafe.ai/api/system-one.md
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

const PROVIDER = "magpie";
const MODEL = "group/decide";
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------------------------------------------------
// Tool parameters

const KINDS = ["choice", "noul", "score"] as const;
type Kind = (typeof KINDS)[number];

const Params = Type.Object({
	// StringEnum emits {type: "string", enum}; Unsafe gives it its static type, which TypeBox cannot infer from it.
	kind: Type.Unsafe<Kind>(StringEnum(KINDS, { description: "Question type" })),
	state: Type.Union(
		[
			Type.String(),
			Type.Object({}, { additionalProperties: true }),
			Type.Array(Type.Unknown()),
		],
		{
			description:
				"The content to judge. A string for one message or passage; a JSON object for named fields or related records; " +
				"a JSON array for a sequence of messages or records. Send identifiers and exact large numbers as strings.",
		},
	),
	question: Type.String({ description: "One sharp question about the state" }),
	options: Type.Optional(
		Type.Array(Type.String(), {
			description: "choice: the options (2 to 255); score: the levels, lowest first (2 to 10). Not used for noul.",
		}),
	),
});

type Params = Static<typeof Params>;

// ---------------------------------------------------------------------------------------------------------------------
// Jev request and reply

type Question =
	| { type: "noul"; instructions: string }
	| { type: "choice"; instructions: string; criteria: Record<string, null> }
	| { type: "score"; instructions: string; criteria: string[] };

const Probabilities = Type.Record(Type.String(), Type.Number());

/** Answer shape per kind, required fields only. noul carries no confidence and no probabilities. */
const Answers = {
	noul: Type.Object({ type: Type.Literal("noul"), noul: Type.Number() }),
	choice: Type.Object({ type: Type.Literal("choice"), choice: Type.String(), confidence: Type.Number(), probabilities: Probabilities }),
	score: Type.Object({ type: Type.Literal("score"), score: Type.Number(), confidence: Type.Number(), probabilities: Probabilities }),
};

type Answer = Static<(typeof Answers)[Kind]>;

/** The envelope; the answer is checked against the schema of the kind that was asked. */
const Reply = Type.Object({ model: Type.String(), answers: Type.Object({ q: Type.Unknown() }) });

/** What the tool returns to the agent. */
type Decision = {
	answer: string | number;
	confidence: number;
	probabilities: Record<string, number> | null;
	model: string;
};

// ---------------------------------------------------------------------------------------------------------------------
// Steps

/** `/systemone` endpoint and key of the `magpie` provider: baseUrl from models.json, key from auth.json. */
async function gateway(ctx: ExtensionContext): Promise<{ url: string; key: string }> {
	const base = ctx.modelRegistry.getProvider(PROVIDER)?.baseUrl;
	if (!base) throw new Error(`decide: provider "${PROVIDER}" has no baseUrl in models.json`);
	const key = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
	if (!key) throw new Error(`decide: provider "${PROVIDER}" has no key in auth.json`);
	return { url: `${base}/systemone`, key };
}

function requireOptions(options: string[] | undefined, max: number, error: string): string[] {
	if (!options || options.length < 2 || options.length > max) throw new Error(error);
	return options;
}

function toQuestion({ kind, question, options }: Params): Question {
	switch (kind) {
		case "noul":
			return { type: "noul", instructions: question };
		case "choice": {
			const choices = requireOptions(options, 255, "choice needs 2 to 255 options");
			return { type: "choice", instructions: question, criteria: Object.fromEntries(choices.map((o) => [o, null])) };
		}
		case "score":
			return { type: "score", instructions: question, criteria: requireOptions(options, 10, "score needs 2 to 10 levels, lowest first") };
	}
}

/** Throws with the first schema error; `at` is where `value` sits in the reply, for the message. */
function check<T extends TSchema>(schema: T, value: unknown, at: string, text: string): asserts value is Static<T> {
	const [error] = Value.Errors(schema, value);
	if (error) throw new Error(`decide: unexpected reply (${at}${error.instancePath} ${error.message}): ${text.slice(0, 300)}`);
}

/** Parses Jev's reply and checks it answers the kind of question that was asked. */
function parseReply(text: string, kind: Kind): { model: string; answer: Answer } {
	const body: unknown = JSON.parse(text);
	check(Reply, body, "", text);
	const answer = body.answers.q;
	check(Answers[kind], answer, "/answers/q", text);
	return { model: body.model, answer };
}

/** noul has no confidence from Jev: it is the distance from 0.5, scaled to 0..1 (docs.typesafe.ai/confidence.md). */
function toDecision(a: Answer, model: string): Decision {
	switch (a.type) {
		case "noul":
			return { answer: a.noul, confidence: Math.abs(2 * a.noul - 1), probabilities: null, model };
		case "choice":
			return { answer: a.choice, confidence: a.confidence, probabilities: a.probabilities, model };
		case "score":
			return { answer: a.score, confidence: a.confidence, probabilities: a.probabilities, model };
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Tool

const decideTool = defineTool({
	name: "decide",
	label: "Decide",
	description:
		"Answer one closed question about a given state with Jev, a fast decision model (no text generation). " +
		"kind=choice picks one of `options`; kind=noul gives the probability (0 to 1) that the yes/no `question` is true; " +
		"kind=score rates on ordered `options` levels, lowest first, and returns a position from 0 to n-1. " +
		"Returns the answer with its confidence and probabilities. Ask one sharp judgement per call; keep arithmetic, counting and date comparisons in code.",
	promptSnippet: "Settle a closed question (choice, yes/no, rating) with the Jev decision model",
	promptGuidelines: [
		"Use decide for a closed judgement on text you already have (which option fits, is this destructive, how severe) instead of reasoning it out at length.",
		"Treat decide answers as signals: act on a choice only when its confidence is at least 0.4; read a noul of 0.7 or more as yes, 0.3 or less as no, and ask the user in between.",
		"Before a destructive or irreversible action, call decide with kind=noul and ask whether the action destroys or irreversibly changes data; if the answer is not clearly no, confirm with the user.",
		"Do not use decide for arithmetic, counting, comparing dates or generating text.",
	],
	parameters: Params,

	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const { url, key } = await gateway(ctx);
		const q = toQuestion(params);
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const res = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "pi-decide" },
			body: JSON.stringify({ model: MODEL, state: params.state, questions: { q } }),
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`decide: HTTP ${res.status} ${text.slice(0, 300)}`);
		const { model, answer } = parseReply(text, params.kind);
		const decision = toDecision(answer, model);
		return { content: [{ type: "text", text: JSON.stringify(decision) }], details: decision };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(decideTool);
}
