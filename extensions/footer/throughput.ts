/**
 * Generation speed of one model response, in tokens per second of streaming: from the first streamed token (text,
 * thinking or tool-call arguments) to the end, so the wait before the first token is measured apart.
 *
 * While the response streams, the provider has not counted the tokens yet: the live rate estimates them from the
 * characters received. Once it ends, the exact rate uses the output tokens the provider reports.
 */

export type Generation = {
	/** When the request was sent. */
	startedAt: number;
	/** When the first token arrived; absent until then. */
	firstTokenAt: number | undefined;
	/** Characters streamed so far. */
	chars: number;
};

/** The usual ratio for English text and code across current tokenizers. */
const CHARS_PER_TOKEN = 4;
/** Below this much streaming, one burst of buffered tokens would read as an absurd speed. */
const MIN_LIVE_WINDOW_MS = 500;

export function startGeneration(now: number): Generation {
	return { startedAt: now, firstTokenAt: undefined, chars: 0 };
}

export function addDelta(generation: Generation, delta: string, now: number): Generation {
	return { ...generation, firstTokenAt: generation.firstTokenAt ?? now, chars: generation.chars + delta.length };
}

export function liveRate(generation: Generation, now: number): number | undefined {
	if (generation.firstTokenAt === undefined) return undefined;
	const window = now - generation.firstTokenAt;
	if (window < MIN_LIVE_WINDOW_MS) return undefined;
	return generation.chars / CHARS_PER_TOKEN / (window / 1000);
}

export function finalRate(generation: Generation, outputTokens: number, endedAt: number): number | undefined {
	if (generation.firstTokenAt === undefined || outputTokens <= 0) return undefined;
	const window = endedAt - generation.firstTokenAt;
	if (window <= 0) return undefined;
	return outputTokens / (window / 1000);
}

export function timeToFirstToken(generation: Generation): number | undefined {
	return generation.firstTokenAt === undefined ? undefined : generation.firstTokenAt - generation.startedAt;
}
