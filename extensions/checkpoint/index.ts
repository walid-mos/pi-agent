/**
 * checkpoint — replaces Pi's compaction with checkpoints under a context ceiling chosen with /ceiling.
 *
 * Below the ceiling, old long tool results are stubbed by code (pruning, no model call). Past the summary threshold,
 * a checkpoint is written in the background on the unchanged conversation, so its request reuses the prompt cache,
 * and held until the ceiling, an idle period past the cache lifetime, or a model change; it is then committed at a
 * turn end, without stopping the run. None is written while it would free less than a pruning step, and a held one is
 * written again when what came after it would leave the context past the summary threshold. A checkpoint is the frozen chunk index, the ledger copied by code from the
 * original entries, and the model's state note; history_read and history_search read the originals back.
 *
 * Pi's own compaction stays enabled at its default reserve as the hard stop: session_before_compact always answers
 * with a checkpoint or cancels with a visible error, so Pi's summary never runs.
 *
 * State machine: machine.ts. Thresholds and the default-ceiling file: config.ts. The design and the papers behind
 * it: ~/Desktop/compaction-state-machine.html.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
	formatTokens,
	isTokenCount,
	MIN_CEILING,
	maxCeiling,
	parseTokenCount,
	piReserveTokens,
	readSettings,
	SETTINGS_FILE,
	saveDefaultCeiling,
	thresholdsFor,
} from "./config.ts";
import { ENTRY_TYPE, Machine, type MachineRecord, readPersisted } from "./machine.ts";
import { CeilingPicker, type Choice } from "./picker.ts";
import { historyRead, historySearch } from "./recall.ts";

export default function checkpoint(pi: ExtensionAPI) {
	const machine = new Machine(pi);

	pi.registerTool(historyRead);
	pi.registerTool(historySearch);

	pi.on("session_start", (_event, ctx) => machine.restore(ctx));
	pi.on("session_tree", (_event, ctx) => machine.restore(ctx));
	pi.on("session_shutdown", () => machine.shutdown());
	pi.on("turn_end", (event, ctx) => machine.onTurnEnd(event, ctx));
	pi.on("session_before_compact", (event, ctx) => machine.onBeforeCompact(event, ctx));
	pi.on("session_compact", () => machine.onCompacted());
	pi.on("session_compact_failed", (event, ctx) => machine.onCompactFailed(ctx, event.errorMessage, event.aborted, event.fromExtension));
	pi.on("agent_start", () => machine.onAgentStart());
	pi.on("agent_settled", (_event, ctx) => machine.onSettled(ctx));
	pi.on("model_select", (_event, ctx) => machine.onModelSelect(ctx));
	// Observed only: returning nothing leaves Pi's warming decision as it is.
	pi.on("cache_warming_decision", (event, ctx) => {
		machine.onCacheWarming(event.action, ctx);
	});

	function apply(choice: Choice, ctx: ExtensionCommandContext): void {
		if (choice.scope === "default") {
			saveDefaultCeiling(choice.ceiling);
			if (readPersisted(ctx.sessionManager.getBranch()).sessionCeiling !== undefined) {
				const record: MachineRecord = { kind: "ceiling", tokens: null };
				pi.appendEntry(ENTRY_TYPE, record);
			}
		} else {
			const record: MachineRecord = { kind: "ceiling", tokens: choice.ceiling };
			pi.appendEntry(ENTRY_TYPE, record);
		}
		machine.settingsChanged(ctx);
		const thresholds = machine.thresholds(ctx);
		const where = choice.scope === "default" ? `default (${SETTINGS_FILE})` : "this session";
		ctx.ui.notify(
			thresholds
				? `Ceiling for ${where}: ${formatTokens(choice.ceiling)}${thresholds.clamped ? `, lowered to ${formatTokens(thresholds.ceiling)} for this model` : ""}. Pruning from ${formatTokens(thresholds.prune)}, background checkpoint from ${formatTokens(thresholds.summary)}.`
				: `Ceiling for ${where}: ${formatTokens(choice.ceiling)}.`,
			"info",
		);
	}

	pi.registerCommand("ceiling", {
		description: "Choose the context ceiling at which a checkpoint replaces old context (/ceiling, /ceiling 300k [--default], /ceiling reset)",
		getArgumentCompletions: (prefix) =>
			["reset", "--default", "128k", "200k", "275k", "400k"]
				.filter((value) => value.startsWith(prefix.trim()))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);
			const scope = words.includes("--default") ? "default" : "session";
			const valueWord = words.find((word) => word !== "--default");
			if (valueWord === "reset") {
				const record: MachineRecord = { kind: "ceiling", tokens: null };
				pi.appendEntry(ENTRY_TYPE, record);
				machine.settingsChanged(ctx);
				const read = readSettings();
				ctx.ui.notify(read.ok ? `This session follows the default ceiling again: ${formatTokens(read.settings.ceiling)}.` : read.error, read.ok ? "info" : "error");
				return;
			}
			if (valueWord) {
				const value = parseTokenCount(valueWord);
				if (value === undefined || !isTokenCount(value)) {
					ctx.ui.notify(`"${valueWord}" is not a ceiling: give a token count of at least ${formatTokens(MIN_CEILING)}, like 300k or 1.2m.`, "error");
					return;
				}
				apply({ ceiling: value, scope }, ctx);
				return;
			}
			const thresholds = machine.thresholds(ctx);
			if (!ctx.model || !thresholds) {
				ctx.ui.notify("No model selected, or the checkpoint settings are unreadable (see /checkpoint).", "error");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify(`Ceiling: ${formatTokens(thresholds.ceiling)}. Set it with /ceiling 300k [--default].`, "info");
				return;
			}
			const model = ctx.model;
			const reserve = piReserveTokens(pi.getSettings(), `${model.provider}/${model.id}`);
			const choice = await ctx.ui.custom<Choice | undefined>(
				(tui, theme, _keybindings, done) =>
					new CeilingPicker(tui, theme, {
						modelLabel: `${model.provider}/${model.id}`,
						contextWindow: model.contextWindow,
						maxCeiling: maxCeiling(model.contextWindow, reserve),
						piThreshold: model.contextWindow - reserve,
						initial: thresholds.requested,
						contextTokens: ctx.getContextUsage()?.tokens ?? undefined,
						sessionHasOwn: readPersisted(ctx.sessionManager.getBranch()).sessionCeiling !== undefined,
						thresholdsOf: (ceiling) => thresholdsFor(ceiling, model.contextWindow, reserve),
					}, done),
			);
			if (choice) apply(choice, ctx);
		},
	});

	pi.registerCommand("checkpoint", {
		description: "Show the checkpoint state (/checkpoint), or re-enable automatic checkpoints after failures (/checkpoint resume)",
		getArgumentCompletions: (prefix) => (["resume"].filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value }))),
		handler: async (args, ctx) => {
			if (args.trim() === "resume") {
				machine.resume(ctx);
				ctx.ui.notify(`Automatic checkpoints re-enabled; phase: ${machine.current.kind}.`, "info");
				return;
			}
			ctx.ui.notify(machine.describe(ctx), "info");
		},
	});
}
