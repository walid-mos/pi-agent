/**
 * footer — replaces Pi's footer with a powerline one and gives the working loader a comet that sweeps its rail.
 *
 * Left: the repository (name, branch, divergence from upstream, staged / modified / untracked / conflicted files,
 * stash, size of the uncommitted diff), then the path, the remote and the last commit. Right: the generation speed
 * (live while a response streams, then the exact rate with a sparkline of the latest responses), the model selected
 * in Pi and, for a Magpie routing group, the model Magpie actually routed the latest request to, read from the
 * `x-magpie-model` response header at each request; then the thinking level, the context window, tokens, cache hits
 * and the upstream subscription quotas Magpie passes through.
 *
 * The routed model is also written to the assistant message as `responseModel`, Pi's field for the model that
 * answered, which Magpie's body leaves at the group's id: a resumed session shows it at once, and Pi's per-model usage
 * counts it under its real name.
 *
 * Colors come from the theme (see render.ts). `/footer` switches between this footer and Pi's own.
 * Tests: `node --test extensions/footer/`.
 */

import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { readRepo } from "./git.ts";
import { type Quota, type Route, readQuotas, readRoute } from "./magpie.ts";
import { cometFrames, type FooterModel, type GitView, renderFooter, type Totals } from "./render.ts";
import { addDelta, finalRate, type Generation, liveRate, startGeneration, timeToFirstToken } from "./throughput.ts";

/** How often the repository is read again while nothing else asks for it (a commit made in another terminal). */
const GIT_POLL_MS = 8_000;
const FRAME_MS = 100;
const SPEED_HISTORY = 12;

/** What Pi is doing, from the start of a run to the moment it settles. */
type Phase =
	| { kind: "preparing" } // between requests: context building, compaction checks, tool results being sent
	| { kind: "waiting"; generation: Generation } // request sent, no token yet
	| { kind: "thinking"; generation: Generation }
	| { kind: "writing"; generation: Generation } // text or tool-call arguments
	| { kind: "tools"; running: ReadonlyMap<string, string> }; // tool calls executing, by call id

type Activity = { kind: "idle" } | { kind: "busy"; since: number; phase: Phase };

type ActivityEvent =
	| { type: "run-started" }
	| { type: "request-sent" }
	| { type: "streamed"; channel: "thinking" | "writing"; delta: string }
	| { type: "response-ended" }
	| { type: "tool-started"; id: string; name: string }
	| { type: "tool-ended"; id: string }
	| { type: "settled" };

function nextActivity(activity: Activity, event: ActivityEvent, now: number): Activity {
	if (event.type === "settled") return { kind: "idle" };
	const busy: Extract<Activity, { kind: "busy" }> =
		activity.kind === "busy" ? activity : { kind: "busy", since: now, phase: { kind: "preparing" } };
	const phase = busy.phase;
	switch (event.type) {
		case "run-started":
			return busy;
		case "request-sent":
			return { ...busy, phase: { kind: "waiting", generation: startGeneration(now) } };
		case "streamed": {
			// A stream whose request went unseen (a provider without the hook) starts its generation at its first token.
			const generation = "generation" in phase ? phase.generation : startGeneration(now);
			return { ...busy, phase: { kind: event.channel, generation: addDelta(generation, event.delta, now) } };
		}
		case "response-ended":
			return { ...busy, phase: { kind: "preparing" } };
		case "tool-started": {
			const running = new Map(phase.kind === "tools" ? phase.running : []);
			running.set(event.id, event.name);
			return { ...busy, phase: { kind: "tools", running } };
		}
		case "tool-ended": {
			if (phase.kind !== "tools") return busy;
			const running = new Map(phase.running);
			running.delete(event.id);
			return { ...busy, phase: running.size > 0 ? { kind: "tools", running } : { kind: "preparing" } };
		}
	}
}

function workingMessage(activity: Activity, now: number): string | undefined {
	if (activity.kind === "idle") return undefined;
	const phase = activity.phase;
	const label =
		phase.kind === "preparing"
			? "Working"
			: phase.kind === "waiting"
				? "Waiting for the model"
				: phase.kind === "thinking"
					? "Thinking"
					: phase.kind === "writing"
						? "Writing"
						: `Running ${[...new Set(phase.running.values())].join(", ")}`;
	return `${label} · ${Math.floor((now - activity.since) / 1000)}s`;
}

/** Reads of the repository never overlap: a read asked for during another one runs once that one ends. */
type GitRead = "idle" | "reading" | "reading-then-again";

type SessionStats = { totals: Totals; cacheHit: number | undefined; context: FooterModel["context"] };

function readSessionStats(ctx: ExtensionContext): SessionStats {
	const totals: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let cacheHit: number | undefined;
	const add = (usage: AssistantMessage["usage"]) => {
		totals.input += usage.input;
		totals.output += usage.output;
		totals.cacheRead += usage.cacheRead;
		totals.cacheWrite += usage.cacheWrite;
		totals.cost += usage.cost.total;
	};
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "usage") add(entry.usage);
		else if (entry.type === "message" && entry.message.role === "assistant") {
			const usage = entry.message.usage;
			add(usage);
			const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
			cacheHit = prompt > 0 ? usage.cacheRead / prompt : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
			add(entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			add(entry.usage);
		}
	}
	return { totals, cacheHit, context: ctx.getContextUsage() };
}

/** The model each routing group last routed to, from the `responseModel` this extension wrote on the branch. */
function routesOnBranch(ctx: ExtensionContext): Map<string, Route> {
	const routes = new Map<string, Route>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message;
		if (!message.responseModel) continue;
		// Magpie names its models `<provider>/<model>`, the provider being what `x-magpie-provider` reports.
		const slash = message.responseModel.indexOf("/");
		routes.set(`${message.provider}/${message.model}`, {
			model: message.responseModel,
			provider: slash > 0 ? message.responseModel.slice(0, slash) : undefined,
		});
	}
	return routes;
}

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	/** Only the TUI draws a footer and a loader; print and RPC modes get nothing from this extension. */
	let interactive = false;
	let enabled = true;
	let requestRender: (() => void) | undefined;

	let activity: Activity = { kind: "idle" };
	let frame = 0;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let shownMessage: string | undefined;

	let git: GitView = { kind: "loading" };
	let gitRead: GitRead = "idle";
	let gitPoll: ReturnType<typeof setInterval> | undefined;

	/** Last route of each routing group, by `<provider>/<group id>`. */
	let routes = new Map<string, Route>();
	/** Route of the request in flight, waiting for its assistant message to be written. */
	let inflightRoute: Route | undefined;
	/** Latest quotas of each upstream provider. */
	const quotas = new Map<string, Quota[]>();

	const history: number[] = [];
	let ttft: number | undefined;
	let stats: SessionStats = { totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, cacheHit: undefined, context: undefined };

	const render = () => requestRender?.();

	function refreshStats() {
		if (ctx) stats = readSessionStats(ctx);
		render();
	}

	async function refreshGit(): Promise<void> {
		if (!ctx || !interactive) return;
		if (gitRead !== "idle") {
			gitRead = "reading-then-again";
			return;
		}
		gitRead = "reading";
		const cwd = ctx.cwd;
		try {
			git = { kind: "ready", repo: await readRepo(cwd) };
		} catch (error) {
			// Shown in place of the branch until a later read succeeds.
			git = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
		}
		// Another call may have changed the state during the await, which TypeScript's narrowing does not see.
		const again = (gitRead as GitRead) === "reading-then-again";
		gitRead = "idle";
		render();
		if (again) await refreshGit();
	}

	function showWorkingMessage() {
		const message = workingMessage(activity, Date.now());
		if (message === shownMessage || !ctx) return;
		shownMessage = message;
		ctx.ui.setWorkingMessage(message);
	}

	function tick() {
		frame++;
		showWorkingMessage();
		render();
	}

	/** The one place where activity changes: it also starts and stops the animation. */
	function apply(event: ActivityEvent) {
		if (!interactive) return;
		const before = activity;
		activity = nextActivity(activity, event, Date.now());
		if (before.kind === "idle" && activity.kind === "busy") {
			if (ctx) ctx.ui.setWorkingIndicator({ frames: cometFrames(ctx.ui.theme), intervalMs: 70 });
			ticker ??= setInterval(tick, FRAME_MS);
		}
		if (activity.kind === "idle" && ticker) {
			clearInterval(ticker);
			ticker = undefined;
			shownMessage = undefined;
		}
		showWorkingMessage();
		render();
	}

	function snapshot(statuses: ReadonlyMap<string, string>): FooterModel {
		const now = Date.now();
		const model = ctx?.model;
		const route = model ? routes.get(`${model.provider}/${model.id}`) : undefined;
		const phase = activity.kind === "busy" ? activity.phase : undefined;
		const generation = phase && "generation" in phase ? phase.generation : undefined;
		return {
			now,
			frame,
			busy: activity.kind === "busy",
			cwd: ctx?.cwd ?? process.cwd(),
			home: homedir(),
			git,
			sessionName: ctx?.sessionManager.getSessionName(),
			model: model ? { provider: model.provider, id: model.id } : undefined,
			route,
			thinking: model?.reasoning ? pi.getThinkingLevel() : undefined,
			speed: {
				live: generation ? liveRate(generation, now) : undefined,
				history: [...history],
				ttft,
				waitingSince: phase?.kind === "waiting" ? phase.generation.startedAt : undefined,
			},
			context: stats.context,
			totals: stats.totals,
			cacheHit: stats.cacheHit,
			quotas: (route?.provider ? quotas.get(route.provider) : model ? quotas.get(model.provider) : undefined) ?? [],
			statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
		};
	}

	function install(current: ExtensionContext) {
		current.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => void refreshGit());
			return {
				dispose() {
					unsubscribe();
					requestRender = undefined;
				},
				invalidate() {},
				render: (width: number) => renderFooter(snapshot(footerData.getExtensionStatuses()), theme, width),
			};
		});
	}

	pi.on("session_start", async (_event, current) => {
		ctx = current;
		interactive = current.mode === "tui";
		if (!interactive) return;
		routes = routesOnBranch(current);
		stats = readSessionStats(current);
		if (enabled) install(current);
		gitPoll ??= setInterval(() => void refreshGit(), GIT_POLL_MS);
		gitPoll.unref();
		await refreshGit();
	});

	pi.on("session_shutdown", async () => {
		if (ticker) clearInterval(ticker);
		if (gitPoll) clearInterval(gitPoll);
		ticker = undefined;
		gitPoll = undefined;
		ctx = undefined;
	});

	pi.on("session_tree", async (_event, current) => {
		ctx = current;
		routes = routesOnBranch(current);
		refreshStats();
	});
	pi.on("session_compact", async (_event, current) => {
		ctx = current;
		refreshStats();
	});
	pi.on("model_select", async (_event, current) => {
		ctx = current;
		refreshStats();
	});
	pi.on("thinking_level_select", async () => render());
	pi.on("input", async () => void refreshGit());

	pi.on("agent_start", async (_event, current) => {
		ctx = current;
		apply({ type: "run-started" });
	});
	pi.on("turn_start", async () => apply({ type: "request-sent" }));

	pi.on("after_provider_response", async (event, current) => {
		const route = readRoute(event.headers);
		const model = current.model;
		// A model called by its own name is routed to itself: only a routing group has a route worth showing.
		if (route && model && route.model !== model.id) {
			inflightRoute = route;
			routes.set(`${model.provider}/${model.id}`, route);
		}
		const received = readQuotas(event.headers);
		const provider = route?.provider ?? model?.provider;
		if (received.length > 0 && provider) quotas.set(provider, received);
		render();
	});

	pi.on("message_update", async (event) => {
		const update = event.assistantMessageEvent;
		if (update.type === "thinking_delta") apply({ type: "streamed", channel: "thinking", delta: update.delta });
		else if (update.type === "text_delta" || update.type === "toolcall_delta") {
			apply({ type: "streamed", channel: "writing", delta: update.delta });
		}
	});

	pi.on("message_end", async (event, current) => {
		ctx = current;
		const message = event.message;
		if (message.role !== "assistant") {
			refreshStats();
			return;
		}
		const phase = activity.kind === "busy" ? activity.phase : undefined;
		if (phase && "generation" in phase) {
			const rate = finalRate(phase.generation, message.usage.output, Date.now());
			if (rate !== undefined) history.push(rate);
			if (history.length > SPEED_HISTORY) history.shift();
			ttft = timeToFirstToken(phase.generation);
		}
		apply({ type: "response-ended" });
		const route = inflightRoute;
		inflightRoute = undefined;
		refreshStats();
		if (route && !message.responseModel) return { message: { ...message, responseModel: route.model } };
	});

	pi.on("tool_execution_start", async (event) => apply({ type: "tool-started", id: event.toolCallId, name: event.toolName }));
	pi.on("tool_execution_end", async (event) => {
		apply({ type: "tool-ended", id: event.toolCallId });
		void refreshGit();
	});

	pi.on("agent_settled", async (_event, current) => {
		ctx = current;
		apply({ type: "settled" });
		current.ui.setWorkingIndicator();
		current.ui.setWorkingMessage();
		refreshStats();
		void refreshGit();
	});

	pi.registerCommand("footer", {
		description: "Switch between the powerline footer and Pi's own",
		handler: async (_args, current) => {
			enabled = !enabled;
			if (enabled) install(current);
			else {
				current.ui.setFooter(undefined);
				requestRender = undefined;
			}
			current.ui.notify(enabled ? "Powerline footer" : "Pi's footer", "info");
		},
	});
}
