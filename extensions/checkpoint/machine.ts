/**
 * The checkpoint state machine: its one `Phase` type and every transition, in this file only.
 *
 *   growing ──(context ≥ summary threshold, at a turn end)──▶ precomputing ──(valid)──▶ ready
 *   ready ──(context ≥ ceiling, at a turn end)──▶ checkpoint committed ──▶ growing
 *   ready ──(idle past the cache lifetime, cache warming stopped, or model changed while idle)──▶ applying ──▶ growing
 *   precomputing or growing ──(context ≥ ceiling)──▶ building (the session waits) ──▶ committed or failed
 *   any failure ──▶ growing with one more failure; the third in a row ──▶ halted (manual /compact still works)
 *
 * Pruning is not a phase: it is a batch of edits written at a turn end while growing. Only the phase lives in
 * memory; the failure count, the last pruning batch and the session's ceiling are custom entries on the branch, so
 * a restart, /resume or /tree reads them back from the session itself.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	CompactionResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBoundaryDraft,
	SessionEntry,
	TurnEndEvent,
	TurnEndEventResult,
} from "@earendil-works/pi-coding-agent";

import { type Checkpoint, CheckpointError, buildCheckpoint, stillApplies, tokensAfter, tooLittleToReplace } from "./checkpoint.ts";
import { formatTokens, piReserveTokens, readSettings, type Settings, type Thresholds, thresholdsFor } from "./config.ts";
import { pruneBatch } from "./prune.ts";

export const ENTRY_TYPE = "checkpoint";
const MAX_FAILURES = 3;

type Outcome = { ok: true; checkpoint: Checkpoint } | { ok: false; error: string };
type Job = { done: Promise<Outcome>; abort: AbortController };

export type Phase =
	| { kind: "growing" }
	| { kind: "precomputing"; job: Job; applyEarly?: string }
	| { kind: "ready"; checkpoint: Checkpoint; applyEarly?: string }
	| { kind: "building"; job: Job }
	| { kind: "applying"; checkpoint: Checkpoint }
	| { kind: "halted"; lastError: string };

/** Custom entries this extension appends to the branch. */
export type MachineRecord =
	| { kind: "prune"; tokensAfter: number }
	| { kind: "failure"; error: string }
	| { kind: "resume" }
	| { kind: "ceiling"; tokens: number | null };

/** What the branch says about this extension, read from its custom entries. */
type Persisted = { failures: number; lastError?: string; tokensAfterPrune?: number; sessionCeiling?: number };

/** Footer text per phase; nothing while the context simply grows. */
const STATUS: { [K in Phase["kind"]]: string | undefined } = {
	growing: undefined,
	precomputing: "checkpoint: writing",
	ready: "checkpoint: ready",
	building: "checkpoint: writing, session waits",
	applying: "checkpoint: applying",
	halted: "checkpoint: halted",
};

function jobOf(phase: Phase): Job | undefined {
	return phase.kind === "precomputing" || phase.kind === "building" ? phase.job : undefined;
}

function recordOf(entry: SessionEntry): MachineRecord | undefined {
	return entry.type === "custom" && entry.customType === ENTRY_TYPE ? (entry.data as MachineRecord) : undefined;
}

export function readPersisted(branch: readonly SessionEntry[]): Persisted {
	const state: Persisted = { failures: 0 };
	let ceilingSeen = false;
	let failuresClosed = false;
	let pruneSeen = false;
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		// A committed compaction or a resume ends a run of failures; a compaction also resets pruning's baseline.
		if (entry.type === "compaction") {
			failuresClosed = true;
			pruneSeen = true;
		}
		const record = recordOf(entry);
		if (!record) continue;
		if (record.kind === "resume") failuresClosed = true;
		if (record.kind === "failure" && !failuresClosed) {
			state.failures++;
			state.lastError ??= record.error;
		}
		if (record.kind === "prune" && !pruneSeen) {
			state.tokensAfterPrune = record.tokensAfter;
			pruneSeen = true;
		}
		if (record.kind === "ceiling" && !ceilingSeen) {
			state.sessionCeiling = record.tokens ?? undefined;
			ceilingSeen = true;
		}
	}
	return state;
}

export class Machine {
	private phase: Phase = { kind: "growing" };
	private idleTimer: NodeJS.Timeout | undefined;
	private settings: Settings | undefined;
	private ui: ExtensionContext["ui"] | undefined;

	constructor(private readonly pi: ExtensionAPI) {}

	// ---- reading --------------------------------------------------------------------------------------------------

	get current(): Phase {
		return this.phase;
	}

	thresholds(ctx: ExtensionContext): Thresholds | undefined {
		if (!this.settings || !ctx.model) return undefined;
		const persisted = readPersisted(ctx.sessionManager.getBranch());
		const reserve = piReserveTokens(this.pi.getSettings(), `${ctx.model.provider}/${ctx.model.id}`);
		return thresholdsFor(persisted.sessionCeiling ?? this.settings.ceiling, ctx.model.contextWindow, reserve);
	}

	// ---- transitions ----------------------------------------------------------------------------------------------

	/** The only assignment of the phase. A running job that the next phase does not carry on is aborted. */
	private to(next: Phase): void {
		const running = jobOf(this.phase);
		if (running && running !== jobOf(next)) running.abort.abort();
		this.phase = next;
		this.ui?.setStatus("checkpoint", STATUS[next.kind]);
	}

	/** session_start and session_tree: the phase is read back from the branch; a held checkpoint belonged to another one. */
	restore(ctx: ExtensionContext): void {
		this.ui = ctx.ui;
		this.clearIdleTimer();
		const read = readSettings();
		if (!read.ok) {
			this.settings = undefined;
			this.to({ kind: "halted", lastError: read.error });
			ctx.ui.notify(`Checkpoint is off: ${read.error}`, "error");
			return;
		}
		this.settings = read.settings;
		const persisted = readPersisted(ctx.sessionManager.getBranch());
		this.to(persisted.failures >= MAX_FAILURES ? { kind: "halted", lastError: persisted.lastError ?? "earlier failures" } : { kind: "growing" });
	}

	shutdown(): void {
		this.clearIdleTimer();
		this.to({ kind: "growing" });
	}

	/** After /ceiling: thresholds are read at each event, so only the settings file is read again; the phase stays. */
	settingsChanged(ctx: ExtensionContext): void {
		const read = readSettings();
		if (!read.ok || !this.settings) return this.restore(ctx);
		this.settings = read.settings;
	}

	describe(ctx: ExtensionContext): string {
		const thresholds = this.thresholds(ctx);
		const persisted = readPersisted(ctx.sessionManager.getBranch());
		const tokens = ctx.getContextUsage()?.tokens;
		const phase = this.phase;
		const lines = [
			`Phase: ${phase.kind}${phase.kind === "halted" ? ` (${phase.lastError})` : ""}${phase.kind === "ready" ? `, replaces about ${formatTokens(phase.checkpoint.tokensReplaced)} with ${formatTokens(phase.checkpoint.tokensCheckpoint)}` : ""}`,
			`In context: ${tokens === null || tokens === undefined ? "unknown until the next response" : formatTokens(tokens)}`,
		];
		if (thresholds) {
			lines.push(
				`Ceiling: ${formatTokens(thresholds.ceiling)}${persisted.sessionCeiling !== undefined ? " (this session's own)" : " (default)"}${thresholds.clamped ? `, lowered from ${formatTokens(thresholds.requested)} for this model` : ""}`,
				`Pruning from ${formatTokens(thresholds.prune)} (last batch left ${persisted.tokensAfterPrune === undefined ? "none yet" : formatTokens(persisted.tokensAfterPrune)}); background checkpoint from ${formatTokens(thresholds.summary)}; verbatim tail ${formatTokens(thresholds.tail)}`,
			);
		}
		lines.push(
			`Failures in a row: ${persisted.failures}/${MAX_FAILURES}${persisted.lastError ? ` (last: ${persisted.lastError})` : ""}`,
			`Checkpoint model: ${this.settings?.summaryModel ?? "the session's model"}; idle apply after ${this.settings?.cacheTtlSeconds ?? "?"}s`,
		);
		return lines.join("\n");
	}

	/** turn_end: prune, start the background checkpoint, or commit one at the ceiling. */
	async onTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<TurnEndEventResult | undefined> {
		const tokens = ctx.getContextUsage()?.tokens;
		const thresholds = this.thresholds(ctx);
		if (tokens === null || tokens === undefined || !thresholds || !ctx.model) return undefined;
		if (event.outcome !== "completed") return undefined;

		// A checkpoint held after a model change is applied at once; one still being written is not waited for.
		const early = this.phase.kind === "ready" ? this.phase.applyEarly : undefined;
		if ((tokens >= thresholds.ceiling || early) && this.phase.kind !== "halted") {
			const checkpoint = await this.obtain(ctx, tokens, thresholds, "foreground");
			if (checkpoint) {
				this.to({ kind: "growing" });
				ctx.ui.notify(this.appliedMessage(ctx, checkpoint, tokens, early), "info");
				return { entries: [...event.entries, this.compactionDraft(checkpoint)] };
			}
			// No checkpoint at the ceiling: pruning is what can still make room. No new checkpoint is started on this
			// same context, which would only repeat the one that just failed or found too little.
			return this.pruneIfDue(event, ctx, tokens, thresholds);
		}

		if (this.phase.kind !== "growing" && this.phase.kind !== "halted") return undefined;
		const pruned = this.pruneIfDue(event, ctx, tokens, thresholds);
		if (pruned) return pruned;
		// A background checkpoint is due only once it would free at least a pruning step (checked by code, no model call).
		if (
			this.phase.kind === "growing" &&
			tokens >= thresholds.summary &&
			!tooLittleToReplace(ctx.sessionManager.buildSessionProjection(), thresholds)
		) {
			this.startJob(ctx, thresholds, "background");
		}
		return undefined;
	}

	private pruneIfDue(event: TurnEndEvent, ctx: ExtensionContext, tokens: number, thresholds: Thresholds): TurnEndEventResult | undefined {
		if (this.phase.kind !== "growing" && this.phase.kind !== "halted") return undefined;
		const persisted = readPersisted(ctx.sessionManager.getBranch());
		const due =
			tokens >= thresholds.prune &&
			(persisted.tokensAfterPrune === undefined || tokens - persisted.tokensAfterPrune >= thresholds.pruneStep);
		if (!due) return undefined;
		const batch = pruneBatch(ctx.sessionManager.buildSessionProjection(), thresholds.tail);
		if (batch.drafts.length === 0) return undefined;
		const record: MachineRecord = { kind: "prune", tokensAfter: tokens - batch.savedTokens };
		// The checkpoint, if due, starts at the next turn end: its request then reuses the pruned prefix that the next
		// real request has just cached.
		return { entries: [...event.entries, ...batch.drafts, { type: "custom", customType: ENTRY_TYPE, data: record }] };
	}

	/** session_before_compact: Pi's own compaction never runs; this returns a checkpoint or cancels, visibly. */
	async onBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<SessionBeforeCompactResult> {
		const tokens = event.preparation.tokensBefore;
		if (event.reason === "manual" && this.phase.kind === "applying") {
			return { compaction: this.compactionResult(ctx, this.phase.checkpoint, tokens) };
		}
		const thresholds = this.thresholds(ctx);
		if (!thresholds) {
			const why = this.phase.kind === "halted" ? this.phase.lastError : "no model or no settings";
			ctx.ui.notify(`Compaction cancelled: checkpoint cannot run (${why}).`, "error");
			return { cancel: true };
		}
		if (event.reason === "threshold" && this.phase.kind === "halted") {
			ctx.ui.notify(`Compaction cancelled: automatic checkpoints are halted (${this.phase.lastError}). Run /compact, or /checkpoint resume.`, "error");
			return { cancel: true };
		}
		if (event.reason === "manual") this.to({ kind: "growing" });
		const checkpoint = await this.obtain(ctx, tokens, thresholds, event.reason === "overflow" ? "overflow" : "foreground", event.customInstructions, event.signal);
		if (!checkpoint) return { cancel: true };
		this.to({ kind: "applying", checkpoint });
		return { compaction: this.compactionResult(ctx, checkpoint, tokens) };
	}

	/** session_compact: a checkpoint (or anything else) was committed through Pi's compaction. */
	onCompacted(): void {
		this.to({ kind: "growing" });
	}

	/** session_compact_failed: only a failure to commit what this extension returned is a checkpoint failure. */
	onCompactFailed(ctx: ExtensionContext, error: string | undefined, aborted: boolean, fromExtension: boolean): void {
		if (this.phase.kind !== "applying" || !fromExtension) return;
		this.to({ kind: "growing" });
		if (!aborted) this.fail(ctx, `committing the checkpoint failed: ${error ?? "no error message"}`);
	}

	/** agent_settled: a held checkpoint is applied once the prompt cache is presumed cold. */
	onSettled(ctx: ExtensionContext): void {
		this.clearIdleTimer();
		if (this.phase.kind !== "ready" || !this.settings) return;
		this.idleTimer = setTimeout(() => this.applyWhileIdle(ctx, "the prompt cache has expired"), this.settings.cacheTtlSeconds * 1000);
		this.idleTimer.unref();
	}

	onAgentStart(): void {
		this.clearIdleTimer();
	}

	/** cache_warming_decision: while Pi keeps the cache warm the idle timer would be wrong; once it stops, apply. */
	onCacheWarming(action: "warm" | "stop", ctx: ExtensionContext): void {
		if (action === "warm") this.clearIdleTimer();
		else this.applyWhileIdle(ctx, "Pi stopped warming the prompt cache");
	}

	/** model_select: the new model has no cache of this conversation, so a held checkpoint costs nothing to apply now. */
	onModelSelect(ctx: ExtensionContext): void {
		const reason = "the model changed";
		if (this.phase.kind === "ready" || this.phase.kind === "precomputing") this.to({ ...this.phase, applyEarly: reason });
		if (ctx.isIdle()) this.applyWhileIdle(ctx, reason);
	}

	resume(ctx: ExtensionContext): void {
		const record: MachineRecord = { kind: "resume" };
		this.pi.appendEntry(ENTRY_TYPE, record);
		this.restore(ctx);
	}

	// ---- actions --------------------------------------------------------------------------------------------------

	private clearIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}

	private applyWhileIdle(ctx: ExtensionContext, reason: string): void {
		this.clearIdleTimer();
		if (this.phase.kind !== "ready" || !ctx.isIdle()) return;
		const stale = stillApplies(this.phase.checkpoint, ctx.sessionManager.getBranch());
		if (stale) {
			this.to({ kind: "growing" });
			ctx.ui.notify(`Held checkpoint discarded: ${stale}.`, "warning");
			return;
		}
		const checkpoint = this.phase.checkpoint;
		this.to({ kind: "applying", checkpoint });
		ctx.ui.notify(`Applying the held checkpoint: ${reason}.`, "info");
		ctx.compact({
			// Pi can refuse before asking this extension ("Nothing to compact" when the context is within its own
			// keepRecentTokens): the checkpoint is not at fault, so it stays held for the ceiling and no failure counts.
			onError: (error) => {
				if (this.phase.kind !== "applying" || this.phase.checkpoint !== checkpoint) return;
				this.to({ kind: "ready", checkpoint });
				ctx.ui.notify(`Pi did not apply the held checkpoint while idle (${error.message}); it is applied at the ceiling instead.`, "warning");
			},
		});
	}

	/** The checkpoint to commit now: the held one if it still applies, else the running job's, else one built now. */
	private async obtain(
		ctx: ExtensionContext,
		tokens: number,
		thresholds: Thresholds,
		mode: "foreground" | "overflow",
		customInstructions?: string,
		signal?: AbortSignal,
	): Promise<Checkpoint | undefined> {
		if (this.phase.kind === "ready") {
			const held = this.phase.checkpoint;
			const stale = stillApplies(held, ctx.sessionManager.getBranch());
			// Everything added since the build stays verbatim after the checkpoint: one that would leave the context past
			// the background threshold is replaced by a fresh one, whose tail starts later.
			const after = stale ? undefined : tokensAfter(held, ctx.sessionManager.buildSessionProjection(), tokens);
			const why =
				stale ??
				(mode === "overflow"
					? "the context overflowed the model, so a smaller one is needed"
					: after === undefined
						? "its first kept entry is not in the context"
						: after >= thresholds.summary
							? `the context after it would be about ${formatTokens(after)}, past the ${formatTokens(thresholds.summary)} background threshold`
							: undefined);
			if (!why) return held;
			ctx.ui.notify(`Held checkpoint discarded: ${why}.`, "warning");
			this.to({ kind: "growing" });
		}
		let job: Job;
		if (this.phase.kind === "building") {
			job = this.phase.job;
		} else if (this.phase.kind === "precomputing" && mode !== "overflow") {
			job = this.phase.job;
			ctx.ui.notify("Context at the ceiling: waiting for the checkpoint being written.", "info");
		} else {
			// Nothing is broken when there is too little to replace, so no failure counts: the turn goes on, and pruning or
			// the next turns make room. The notice stays visible each time, since it can also mean the ceiling is too low.
			const tooLittle = mode === "overflow" ? undefined : tooLittleToReplace(ctx.sessionManager.buildSessionProjection(), thresholds);
			if (tooLittle) {
				ctx.ui.notify(`Context at ${formatTokens(tokens)}, but no checkpoint now: ${tooLittle}.`, "warning");
				return undefined;
			}
			if (this.phase.kind === "precomputing") this.to({ kind: "growing" });
			ctx.ui.notify(`Context at ${formatTokens(tokens)}: writing a checkpoint now; the session waits.`, "info");
			job = this.startJob(ctx, thresholds, mode, customInstructions, signal);
		}
		this.to({ kind: "building", job });
		const outcome = await job.done;
		if (this.phase.kind !== "building" || this.phase.job !== job) return undefined; // superseded (session replaced)
		if (outcome.ok) {
			const stale = stillApplies(outcome.checkpoint, ctx.sessionManager.getBranch());
			if (!stale) return outcome.checkpoint;
			this.to({ kind: "growing" });
			this.fail(ctx, `the checkpoint no longer applies: ${stale}`);
			return undefined;
		}
		this.to({ kind: "growing" });
		this.fail(ctx, outcome.error);
		return undefined;
	}

	/** Starts writing a checkpoint. In the background the phase becomes precomputing and the turn goes on. */
	private startJob(
		ctx: ExtensionContext,
		thresholds: Thresholds,
		mode: "background" | "foreground" | "overflow",
		customInstructions?: string,
		signal?: AbortSignal,
	): Job {
		const abort = new AbortController();
		if (signal) signal.addEventListener("abort", () => abort.abort(), { once: true });
		const done = this.build(ctx, thresholds, mode, abort.signal, customInstructions);
		const job: Job = { done, abort };
		if (mode === "background") {
			this.to({ kind: "precomputing", job });
			void done.then((outcome) => this.onJobDone(ctx, job, outcome));
		}
		return job;
	}

	private onJobDone(ctx: ExtensionContext, job: Job, outcome: Outcome): void {
		// Only a job still in precomputing settles here; one awaited in the foreground settles in obtain().
		if (this.phase.kind !== "precomputing" || this.phase.job !== job) return;
		const applyEarly = this.phase.applyEarly;
		if (outcome.ok) {
			this.to({ kind: "ready", checkpoint: outcome.checkpoint, applyEarly });
			if (applyEarly && ctx.isIdle()) this.applyWhileIdle(ctx, applyEarly);
			return;
		}
		this.to({ kind: "growing" });
		this.fail(ctx, outcome.error);
	}

	private async build(
		ctx: ExtensionContext,
		thresholds: Thresholds,
		mode: "background" | "foreground" | "overflow",
		signal: AbortSignal,
		customInstructions?: string,
	): Promise<Outcome> {
		try {
			const model = this.summaryModel(ctx);
			const level = this.pi.getThinkingLevel();
			const checkpoint = await buildCheckpoint({
				branch: ctx.sessionManager.getBranch(),
				projection: ctx.sessionManager.buildSessionProjection(),
				leafId: ctx.sessionManager.getLeafId(),
				thresholds,
				model,
				registry: ctx.modelRegistry,
				sessionId: ctx.sessionManager.getSessionId(),
				reasoning: level === "off" ? undefined : level,
				mode: mode === "overflow" ? "overflow" : "normal",
				customInstructions,
				repository: await this.repository(ctx, signal),
				signal,
			});
			return { ok: true, checkpoint };
		} catch (error) {
			const message = error instanceof CheckpointError ? error.message : `unexpected error: ${(error as Error).stack ?? String(error)}`;
			return { ok: false, error: message };
		}
	}

	private summaryModel(ctx: ExtensionContext): Model<Api> {
		const wanted = this.settings?.summaryModel;
		if (!wanted) {
			if (!ctx.model) throw new CheckpointError("no model selected");
			return ctx.model;
		}
		const slash = wanted.indexOf("/");
		const model = ctx.modelRegistry.find(wanted.slice(0, slash), wanted.slice(slash + 1));
		if (!model) throw new CheckpointError(`summaryModel ${wanted} is not a known model`);
		return model;
	}

	private async repository(ctx: ExtensionContext, signal: AbortSignal): Promise<string> {
		const status = await this.pi.exec("git", ["status", "--short", "--branch"], { cwd: ctx.cwd, timeout: 5_000, signal });
		if (status.code !== 0) return `git status failed (exit ${status.code}): ${(status.stderr || status.stdout).trim().split("\n")[0]}`;
		const head = await this.pi.exec("git", ["log", "-1", "--format=%h %s"], { cwd: ctx.cwd, timeout: 5_000, signal });
		const lines = status.stdout.trim().split("\n");
		const shown = lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n(+${lines.length - 40} more files)` : "");
		return `${ctx.cwd}\n${shown}\nHEAD: ${head.code === 0 ? head.stdout.trim() : `unreadable (exit ${head.code})`}`;
	}

	private fail(ctx: ExtensionContext, error: string): void {
		const failures = readPersisted(ctx.sessionManager.getBranch()).failures + 1;
		const record: MachineRecord = { kind: "failure", error };
		// The entry is the log: it stays in the session file, next to what failed.
		this.pi.appendEntry(ENTRY_TYPE, record);
		if (failures >= MAX_FAILURES) {
			this.to({ kind: "halted", lastError: error });
			ctx.ui.notify(`Checkpoint failed ${failures} times in a row; automatic checkpoints are halted. Last error: ${error}. /compact still works; /checkpoint resume re-enables them.`, "error");
		} else {
			ctx.ui.notify(`Checkpoint failed (${failures}/${MAX_FAILURES}): ${error}`, "warning");
		}
	}

	private compactionDraft(checkpoint: Checkpoint): SessionBoundaryDraft {
		return { type: "compaction", summary: checkpoint.summary, firstKeptEntryId: checkpoint.firstKeptEntryId, details: checkpoint.details, usage: checkpoint.usage };
	}

	private compactionResult(ctx: ExtensionContext, checkpoint: Checkpoint, tokensBefore: number): CompactionResult {
		return {
			summary: checkpoint.summary,
			firstKeptEntryId: checkpoint.firstKeptEntryId,
			tokensBefore,
			estimatedTokensAfter: tokensAfter(checkpoint, ctx.sessionManager.buildSessionProjection(), tokensBefore),
			usage: checkpoint.usage,
			details: checkpoint.details,
		};
	}

	private appliedMessage(ctx: ExtensionContext, checkpoint: Checkpoint, tokens: number, early: string | undefined): string {
		const after = tokensAfter(checkpoint, ctx.sessionManager.buildSessionProjection(), tokens);
		const chunks = checkpoint.details.chunks.length;
		return `Checkpoint applied${early ? ` (${early})` : ""}: ${formatTokens(tokens)} → ${after === undefined ? "a size not estimated" : `about ${formatTokens(after)}`} tokens, ${chunks} chunk${chunks === 1 ? "" : "s"} indexed.`;
	}
}
