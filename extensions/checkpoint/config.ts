/**
 * The ceiling, the thresholds derived from it, and the machine-local file that holds the default ceiling.
 *
 * The ceiling is the context size at which a checkpoint is forced in. Everything else scales from it with the
 * ratios of the design (prune at 60 %, start the summary at 70 %, force at 90 % of a budget W, so the ceiling is
 * 0.9 W). They are starting values taken from the papers, not tuned on real sessions.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_COMPACTION_SETTINGS, getAgentDir } from "@earendil-works/pi-coding-agent";

/** Room kept between the ceiling and Pi's own threshold, for the checkpoint request's output. */
const SUMMARY_HEADROOM_TOKENS = 16_000;
/** Below this a checkpoint would be mostly fixed overhead (prompt, tools, ledger). */
export const MIN_CEILING = 24_000;
/** Ceiling of a session that has no choice of its own and no default saved with /ceiling. */
export const DEFAULT_CEILING = 275_000;
/** Idle time after which a held checkpoint is applied: provider prompt caches expire after about five minutes. */
const DEFAULT_CACHE_TTL_SECONDS = 300;

export const SETTINGS_FILE = join(getAgentDir(), "checkpoint.json");

export type Settings = {
	/** Ceiling for sessions without their own choice. */
	ceiling: number;
	/** "provider/modelId" that writes checkpoints; absent means the session's model, which shares its prompt cache. */
	summaryModel?: string;
	/** Idle time after which a held checkpoint is applied, the prompt cache being presumed cold. */
	cacheTtlSeconds: number;
};

export type SettingsRead = { ok: true; settings: Settings } | { ok: false; error: string };

/** Reads the settings file. A missing file means the declared defaults; an unreadable one is an error, never ignored. */
export function readSettings(): SettingsRead {
	const defaults: Settings = { ceiling: DEFAULT_CEILING, cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS };
	if (!existsSync(SETTINGS_FILE)) return { ok: true, settings: defaults };
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
	} catch (error) {
		return { ok: false, error: `${SETTINGS_FILE} is not valid JSON: ${(error as Error).message}` };
	}
	if (typeof raw !== "object" || raw === null) return { ok: false, error: `${SETTINGS_FILE} must hold a JSON object` };
	const { ceiling, summaryModel, cacheTtlSeconds } = raw as Record<string, unknown>;
	if (ceiling !== undefined && !isTokenCount(ceiling)) {
		return { ok: false, error: `${SETTINGS_FILE}: "ceiling" must be a whole number of tokens of at least ${MIN_CEILING}` };
	}
	if (summaryModel !== undefined && (typeof summaryModel !== "string" || !summaryModel.includes("/"))) {
		return { ok: false, error: `${SETTINGS_FILE}: "summaryModel" must be "provider/modelId"` };
	}
	if (cacheTtlSeconds !== undefined && !(Number.isInteger(cacheTtlSeconds) && (cacheTtlSeconds as number) > 0)) {
		return { ok: false, error: `${SETTINGS_FILE}: "cacheTtlSeconds" must be a positive whole number` };
	}
	return {
		ok: true,
		settings: {
			ceiling: (ceiling as number | undefined) ?? defaults.ceiling,
			summaryModel: summaryModel as string | undefined,
			cacheTtlSeconds: (cacheTtlSeconds as number | undefined) ?? defaults.cacheTtlSeconds,
		},
	};
}

/** Saves the default ceiling, keeping the file's other keys as they are. */
export function saveDefaultCeiling(ceiling: number): void {
	const current = existsSync(SETTINGS_FILE) ? (JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as object) : {};
	writeFileSync(SETTINGS_FILE, `${JSON.stringify({ ...current, ceiling }, null, "\t")}\n`);
}

export function isTokenCount(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= MIN_CEILING;
}

type CompactionSettingsShape = {
	reserveTokens?: number;
	modelOverrides?: Record<string, { reserveTokens?: number }>;
};

/** Pi's own compaction reserve for a model, resolved as Pi resolves it: model override, setting, built-in default. */
export function piReserveTokens(settings: unknown, modelKey: string): number {
	const compaction = (settings as { compaction?: CompactionSettingsShape }).compaction;
	return (
		compaction?.modelOverrides?.[modelKey]?.reserveTokens ??
		compaction?.reserveTokens ??
		DEFAULT_COMPACTION_SETTINGS.reserveTokens
	);
}

/** The largest ceiling a model allows: below Pi's own threshold, with room for the checkpoint request's output. */
export function maxCeiling(contextWindow: number, piReserve: number): number {
	return Math.max(MIN_CEILING, contextWindow - piReserve - SUMMARY_HEADROOM_TOKENS);
}

export type Thresholds = {
	/** The ceiling asked for. */
	requested: number;
	/** The ceiling in force: the requested one, lowered to what the model's window allows. */
	ceiling: number;
	clamped: boolean;
	/** First pruning batch. */
	prune: number;
	/** Growth since the previous batch that starts the next one. */
	pruneStep: number;
	/** The background checkpoint starts here. */
	summary: number;
	/** Recent context kept verbatim after a checkpoint. */
	tail: number;
	/** Once the chunk index is larger than this, the next pass merges its oldest chunks again from the originals. */
	rollup: number;
	/** Output budget of the state note. */
	noteTokens: number;
	/** Budget of the ledger written by code. */
	ledgerTokens: number;
};

export function thresholdsFor(requested: number, contextWindow: number, piReserve: number): Thresholds {
	const ceiling = Math.min(requested, maxCeiling(contextWindow, piReserve));
	const budget = ceiling / 0.9;
	return {
		requested,
		ceiling,
		clamped: ceiling < requested,
		prune: Math.round(budget * 0.6),
		pruneStep: Math.round(budget * 0.15),
		summary: Math.round(budget * 0.7),
		tail: Math.min(30_000, Math.round(budget * 0.12)),
		rollup: Math.round(budget * 0.15),
		noteTokens: Math.min(12_000, Math.max(2_000, Math.round(budget * 0.05))),
		ledgerTokens: Math.min(12_000, Math.max(2_000, Math.round(budget * 0.05))),
	};
}

/** "275k", "1.2m", "300000", "300_000" → tokens; undefined when the text is not a count. */
export function parseTokenCount(text: string): number | undefined {
	const match = text
		.trim()
		.toLowerCase()
		.replace(/[_,\s]/g, "")
		.match(/^(\d+(?:\.\d+)?)([km]?)$/);
	if (!match) return undefined;
	const scale = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
	const value = Math.round(Number(match[1]) * scale);
	return Number.isSafeInteger(value) ? value : undefined;
}

export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens % 1_000 === 0 ? 0 : 1)}k`;
	return String(tokens);
}
