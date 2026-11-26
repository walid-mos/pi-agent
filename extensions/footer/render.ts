/**
 * Drawing of the footer and of the working loader, from a plain snapshot of what they show.
 *
 * Every color comes from the active theme: the accent and the panel backgrounds (`selectedBg`, `toolPendingBg`)
 * colour the powerline pills, the semantic tokens colour git states and gauges, and the text drawn on the accent is
 * whichever of a dark or light tint of the accent's hue contrasts more with it. The footer therefore follows any
 * theme, and the `system` theme's switches between light and dark.
 *
 * Glyphs are Nerd Font ones (powerline separators, icons from the Font Awesome, Octicons and Devicons sets, all one
 * cell wide); they are grouped in `GLYPHS` to change them in one place.
 */

import type { ContextUsage, Theme } from "@earendil-works/pi-coding-agent";
import { type Color, colorToOkhsl, colorToRgb, mixColors, okhslColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Repo } from "./git.ts";
import type { Quota, Route } from "./magpie.ts";

export const GLYPHS = {
	arrowRight: "", //
	arrowLeft: "", //
	capLeft: "", //
	capRight: "", //
	pi: "π",
	repo: "", //  octicons repo
	folder: "", //  folder
	branch: "", //  git branch
	commit: "", //  git commit
	github: "", //  github
	gitlab: "", //  gitlab
	server: "", //  any other remote host
	route: "", //  sitemap: a routing group
	bolt: "", //  speed
	clock: "", //  time to first token
	database: "", //  context window
	cache: "", //  cache hits
	gauge: "", //  subscription quota
	thinking: "", //  thinking level
	session: "", //  session name
	warning: "", //  error reading git
	ahead: "⇡",
	behind: "⇣",
	staged: "●",
	modified: "✚",
	untracked: "…",
	conflicted: "✖",
	stash: "≡",
	clean: "✔",
	separator: "·",
	spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	spark: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],
	barFull: "━",
	barHalf: "╸",
	barEmpty: "─",
} as const;

/** Upstream providers Magpie routes to, by the `x-magpie-provider` name, and their mark. */
const PROVIDER_MARKS: Record<string, string> = { claude: "✻", codex: "◎", inco: "◇" };

export type GitView =
	| { kind: "loading" }
	| { kind: "ready"; repo: Repo }
	| { kind: "failed"; message: string };

export type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };

/** What one frame of the footer shows. */
export type FooterModel = {
	now: number;
	/** Animation frame counter; it advances only while Pi works. */
	frame: number;
	busy: boolean;
	cwd: string;
	home: string;
	git: GitView;
	sessionName: string | undefined;
	/** The model selected in Pi: a Magpie routing group or any other model. */
	model: { provider: string; id: string } | undefined;
	/** The model Magpie routed the latest request of that group to. */
	route: Route | undefined;
	/** Thinking level, for a reasoning model. */
	thinking: ThinkingLevel | undefined;
	speed: {
		/** Estimate for the response streaming now. */
		live: number | undefined;
		/** Exact rates of the latest responses, oldest first. */
		history: number[];
		/** Wait before the first token of the latest response. */
		ttft: number | undefined;
		/** When the request in flight was sent and no token came yet. */
		waitingSince: number | undefined;
	};
	context: ContextUsage | undefined;
	totals: Totals;
	/** Share of the latest prompt read from the cache, 0 to 1. */
	cacheHit: number | undefined;
	quotas: Quota[];
	statuses: string[];
};

type Palette = {
	accent: Color;
	onAccent: Color;
	/** A second accent from the theme, for the repository pill. */
	accent2: Color;
	onAccent2: Color;
	/** Brightest point of the glint sweeping the routed model's pill while Pi works. */
	glint: Color;
	panel: Color;
	panelSoft: Color;
	text: Color;
	muted: Color;
	dim: Color;
	rail: Color;
	success: Color;
	warning: Color;
	error: Color;
	added: Color;
	removed: Color;
	hash: Color;
};

function luminance(color: Color): number {
	const { r, g, b } = colorToRgb(color);
	const channel = (value: number) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(first: Color, second: Color): number {
	const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return (light + 0.05) / (dark + 0.05);
}

/** A dark or a light tint of the background's hue, whichever reads better on it. */
function onColor(background: Color): Color {
	const { h } = colorToOkhsl(background);
	const dark = okhslColor(h, 0.4, 0.14);
	const light = okhslColor(h, 0.3, 0.97);
	return contrast(background, dark) >= contrast(background, light) ? dark : light;
}

// Theme objects keep the same `colors` object until the theme or the terminal colors change.
const palettes = new WeakMap<object, Palette>();

function paletteOf(theme: Theme): Palette {
	const colors = theme.colors;
	const cached = palettes.get(colors);
	if (cached) return cached;
	const onAccent = onColor(colors.accent);
	const palette: Palette = {
		accent: colors.accent,
		onAccent,
		accent2: colors.mdHeading,
		onAccent2: onColor(colors.mdHeading),
		glint: mixColors(colors.accent, luminance(onAccent) < 0.5 ? okhslColor(0, 0, 1) : okhslColor(0, 0, 0), 0.3),
		panel: colors.selectedBg,
		panelSoft: colors.toolPendingBg,
		text: colors.text,
		muted: colors.muted,
		dim: colors.dim,
		rail: colors.borderMuted,
		success: colors.success,
		warning: colors.warning,
		error: colors.error,
		added: colors.toolDiffAdded,
		removed: colors.toolDiffRemoved,
		hash: colors.syntaxFunction,
	};
	palettes.set(colors, palette);
	return palette;
}

// ── text helpers ────────────────────────────────────────────────────────────────────────────────────────────────

type Paint = (text: string, fg: Color, bold?: boolean) => string;

function painter(theme: Theme): Paint {
	return (text, fg, bold = false) => theme.style(text, { fg, bold });
}

export function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatAge(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 60) return `${days}d`;
	return `${Math.round(days / 30)}mo`;
}

function formatSeconds(ms: number): string {
	return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function tildePath(path: string, home: string): string {
	if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
	return path;
}

/**
 * The path shortened fish-style until it fits in `max` columns: parent directories cut to their first letter (two for
 * a dot directory), from the outermost in, the last one kept whole; then only the last one, after an ellipsis.
 */
export function abbreviatePath(path: string, max: number): string {
	if (visibleWidth(path) <= max) return path;
	const segments = path.split("/");
	for (let index = 0; index < segments.length - 1; index++) {
		const segment = segments[index];
		if (segment === "" || segment === "~") continue;
		segments[index] = segment.startsWith(".") ? segment.slice(0, 2) : segment.slice(0, 1);
		const shortened = segments.join("/");
		if (visibleWidth(shortened) <= max) return shortened;
	}
	return `…/${shorten(segments.at(-1) ?? "", Math.max(1, max - 2))}`;
}

function shorten(text: string, max: number): string {
	return visibleWidth(text) <= max ? text : `${truncateToWidth(text, Math.max(1, max - 1), "")}…`;
}

/** Green to amber to red as `share` (0 to 1) grows. */
function heat(palette: Palette, share: number): Color {
	const clamped = Math.min(1, Math.max(0, share));
	return clamped < 0.6
		? mixColors(palette.success, palette.warning, clamped / 0.6)
		: mixColors(palette.warning, palette.error, (clamped - 0.6) / 0.4);
}

/** A bar of `cells` heavy-line cells, half-cell resolution, each filled cell coloured by its position on the heat scale. */
function heatBar(paint: Paint, palette: Palette, share: number, cells: number): string {
	const halves = Math.round(Math.min(1, Math.max(0, share)) * cells * 2);
	let bar = "";
	for (let cell = 0; cell < cells; cell++) {
		const filled = halves - cell * 2;
		const color = heat(palette, (cell + 0.5) / cells);
		if (filled >= 2) bar += paint(GLYPHS.barFull, color);
		else if (filled === 1) bar += paint(GLYPHS.barHalf, color);
		else bar += paint(GLYPHS.barEmpty, palette.rail);
	}
	return bar;
}

function sparkline(paint: Paint, palette: Palette, values: number[]): string {
	const max = Math.max(...values);
	return values
		.map((value) => {
			const share = max > 0 ? value / max : 0;
			const level = Math.min(GLYPHS.spark.length - 1, Math.round(share * (GLYPHS.spark.length - 1)));
			return paint(GLYPHS.spark[level], mixColors(palette.muted, palette.accent, share));
		})
		.join("");
}

// ── powerline pills ─────────────────────────────────────────────────────────────────────────────────────────────

/** One pill: its background, and its body already drawn on it (padding included). */
type Pill = { bg: Color; body: string };

function pill(theme: Theme, content: string, bg: Color): Pill {
	return { bg, body: theme.style(` ${content} `, { bg }) };
}

/** Pills joined left to right by  arrows, opened by a rounded cap: the left half of a line. */
function chainFromLeft(theme: Theme, pills: Pill[]): string {
	if (pills.length === 0) return "";
	let out = theme.style(GLYPHS.capLeft, { fg: pills[0].bg });
	pills.forEach((current, index) => {
		const next = pills[index + 1];
		out += current.body + theme.style(GLYPHS.arrowRight, { fg: current.bg, bg: next?.bg });
	});
	return out;
}

/** Pills joined right to left by  arrows, closed by a rounded cap: the right half of a line. */
function chainFromRight(theme: Theme, pills: Pill[]): string {
	if (pills.length === 0) return "";
	let out = "";
	pills.forEach((current, index) => {
		const previous = pills[index - 1];
		out += theme.style(GLYPHS.arrowLeft, { fg: current.bg, bg: previous?.bg }) + current.body;
	});
	return out + theme.style(GLYPHS.capRight, { fg: pills[pills.length - 1].bg });
}

/** Text on the accent with a band of light sweeping across it, one cell at a time. */
function glinting(theme: Theme, palette: Palette, text: string, frame: number, bold: boolean): string {
	const chars = [...` ${text} `];
	const span = chars.length + 12;
	const position = (frame % span) - 6;
	return chars
		.map((char, index) => {
			const strength = Math.max(0, 1 - Math.abs(index - position) / 5) ** 1.5;
			const bg = strength > 0 ? mixColors(palette.accent, palette.glint, strength) : palette.accent;
			return theme.style(char, { fg: palette.onAccent, bg, bold });
		})
		.join("");
}

// ── line 1: repository and branch | speed, group, routed model, thinking ───────────────────────────────────────

/** Ordered simplifications for a narrow terminal; each level keeps those before it. */
const TOP_LEVELS = [
	"full",
	"no-sparkline",
	"branch-24",
	"no-logo",
	"short-group",
	"no-diff",
	"no-thinking-label",
	"no-speed",
	"no-repo-pill",
	"branch-16",
	"no-group",
	"bare-model",
	"no-thinking",
	"branch-10",
] as const;
type TopLevel = (typeof TOP_LEVELS)[number];

function atLeast(level: TopLevel, step: TopLevel): boolean {
	return TOP_LEVELS.indexOf(level) >= TOP_LEVELS.indexOf(step);
}

function gitChips(paint: Paint, palette: Palette, repo: Extract<Repo, { kind: "repo" }>, withDiff: boolean): string {
	const { status, diff } = repo;
	const chips: string[] = [];
	if (status.conflicted) chips.push(paint(`${GLYPHS.conflicted}${status.conflicted}`, palette.error, true));
	if (status.staged) chips.push(paint(`${GLYPHS.staged}${status.staged}`, palette.success));
	if (status.modified) chips.push(paint(`${GLYPHS.modified}${status.modified}`, palette.warning));
	if (status.untracked) chips.push(paint(`${GLYPHS.untracked}${status.untracked}`, palette.muted));
	if (status.stash) chips.push(paint(`${GLYPHS.stash}${status.stash}`, palette.accent));
	if (chips.length === 0) chips.push(paint(GLYPHS.clean, palette.success));
	if (withDiff && (diff.insertions || diff.deletions)) {
		chips.push(`${paint(`+${diff.insertions}`, palette.added)} ${paint(`-${diff.deletions}`, palette.removed)}`);
	}
	return chips.join(" ");
}

function leftTop(model: FooterModel, theme: Theme, palette: Palette, level: TopLevel): string {
	const paint = painter(theme);
	const pills: Pill[] = [];
	if (!atLeast(level, "no-logo")) {
		// While Pi works the logo breathes, its accent brightening and dimming once every three seconds.
		const breath = model.busy ? (1 - Math.cos((model.frame / 30) * 2 * Math.PI)) / 2 : 0;
		const bg = breath > 0 ? mixColors(palette.accent, palette.glint, breath) : palette.accent;
		pills.push(pill(theme, theme.style(GLYPHS.pi, { fg: onColor(bg), bold: true }), bg));
	}
	let chips = "";
	const git = model.git;
	if (git.kind === "ready" && git.repo.kind === "repo") {
		const repo = git.repo;
		if (!atLeast(level, "no-repo-pill")) {
			pills.push(pill(theme, paint(`${GLYPHS.repo} ${repo.name}`, palette.onAccent2, true), palette.accent2));
		}
		const { head, ahead, behind } = repo.status;
		const maxBranch = atLeast(level, "branch-10") ? 10 : atLeast(level, "branch-16") ? 16 : atLeast(level, "branch-24") ? 24 : 48;
		let branch =
			head.kind === "branch"
				? paint(`${GLYPHS.branch} ${shorten(head.name, maxBranch)}`, palette.accent, true)
				: head.kind === "detached"
					? paint(`${GLYPHS.commit} ${head.oid.slice(0, 7)}`, palette.warning, true)
					: paint(`${GLYPHS.branch} ${shorten(head.name, maxBranch)} (no commit)`, palette.accent, true);
		if (ahead) branch += paint(` ${GLYPHS.ahead}${ahead}`, palette.success);
		if (behind) branch += paint(` ${GLYPHS.behind}${behind}`, palette.warning);
		pills.push(pill(theme, branch, palette.panelSoft));
		chips = gitChips(paint, palette, repo, !atLeast(level, "no-diff"));
	} else {
		const folder = model.cwd.split("/").filter(Boolean).at(-1) ?? "/";
		pills.push(pill(theme, paint(`${GLYPHS.folder} ${folder}`, palette.onAccent2, true), palette.accent2));
		if (git.kind === "loading") chips = paint("…", palette.dim);
		if (git.kind === "failed") chips = paint(`${GLYPHS.warning} ${git.message}`, palette.error);
	}
	return chips ? `${chainFromLeft(theme, pills)} ${chips}` : chainFromLeft(theme, pills);
}

function speedPill(model: FooterModel, theme: Theme, palette: Palette, level: TopLevel): Pill | undefined {
	const paint = painter(theme);
	const { live, history, waitingSince } = model.speed;
	if (model.busy) {
		const spinner = paint(GLYPHS.spinner[model.frame % GLYPHS.spinner.length], palette.accent, true);
		const detail =
			live !== undefined
				? ` ${paint(`${Math.round(live)} tok/s`, palette.text, true)}`
				: waitingSince !== undefined
					? ` ${paint(formatSeconds(model.now - waitingSince), palette.muted)}`
					: "";
		return pill(theme, spinner + detail, palette.panelSoft);
	}
	const last = history.at(-1);
	if (last === undefined) return undefined;
	let content = `${paint(GLYPHS.bolt, palette.accent)} ${paint(`${Math.round(last)} tok/s`, palette.text, true)}`;
	if (history.length > 1 && !atLeast(level, "no-sparkline")) content += ` ${sparkline(paint, palette, history)}`;
	return pill(theme, content, palette.panelSoft);
}

const THINKING_TOKENS = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
} as const;

export type ThinkingLevel = keyof typeof THINKING_TOKENS;

/** The model's name on the accent: provider mark, routing prefix in a softer tone, name in bold; glinting while Pi works. */
function modelPill(model: FooterModel, theme: Theme, palette: Palette, label: string, level: TopLevel): Pill {
	const slash = label.indexOf("/");
	const prefix = slash >= 0 && !atLeast(level, "bare-model") ? label.slice(0, slash + 1) : "";
	const name = label.slice(slash + 1);
	const mark = model.route?.provider ? PROVIDER_MARKS[model.route.provider] : undefined;
	const lead = mark ? `${mark} ` : "";
	if (model.busy) return { bg: palette.accent, body: glinting(theme, palette, `${lead}${prefix}${name}`, model.frame, true) };
	return {
		bg: palette.accent,
		body:
			theme.style(` ${lead}`, { fg: palette.onAccent, bg: palette.accent, bold: true }) +
			theme.style(prefix, { fg: mixColors(palette.onAccent, palette.accent, 0.4), bg: palette.accent }) +
			theme.style(`${name} `, { fg: palette.onAccent, bg: palette.accent, bold: true }),
	};
}

function rightTop(model: FooterModel, theme: Theme, palette: Palette, level: TopLevel): string {
	const paint = painter(theme);
	const pills: Pill[] = [];
	if (!atLeast(level, "no-speed")) {
		const speed = speedPill(model, theme, palette, level);
		if (speed) pills.push(speed);
	}
	const selected = model.model;
	if (!selected) {
		pills.push(pill(theme, paint("no model", palette.muted), palette.panel));
		return chainFromRight(theme, pills);
	}
	// A routing group shows its own pill, then the model it routed to; any other model is shown alone.
	const routed = model.route;
	if (routed && !atLeast(level, "no-group")) {
		const group = atLeast(level, "short-group") ? selected.id.replace(/^group\//, "") : selected.id;
		pills.push(pill(theme, paint(`${GLYPHS.route} ${group}`, palette.text), palette.panel));
	}
	pills.push(modelPill(model, theme, palette, routed ? routed.model : selected.id, level));
	if (model.thinking && !atLeast(level, "no-thinking")) {
		const color = theme.colors[THINKING_TOKENS[model.thinking]];
		const content = atLeast(level, "no-thinking-label") ? GLYPHS.thinking : `${GLYPHS.thinking} ${model.thinking}`;
		pills.push(pill(theme, theme.style(content, { fg: onColor(color), bold: true }), color));
	}
	return chainFromRight(theme, pills);
}

function topLine(model: FooterModel, theme: Theme, palette: Palette, width: number): string {
	let left = "";
	let right = "";
	for (const level of TOP_LEVELS) {
		left = leftTop(model, theme, palette, level);
		right = rightTop(model, theme, palette, level);
		const gap = width - visibleWidth(left) - visibleWidth(right);
		if (gap >= 1) return left + " ".repeat(gap) + right;
	}
	// Narrower than every level: the models stay whole, the repository side is cut.
	return truncateToWidth(left, Math.max(0, width - visibleWidth(right) - 1), "…") + " " + right;
}

// ── line 2: path and last commit | context, tokens, cache, quota, first-token wait ─────────────────────────────

const BOTTOM_LEVELS = [
	"full",
	"no-ttft",
	"no-remote",
	"no-cache",
	"no-tokens",
	"short-path",
	"short-bar",
	"no-quota",
	"no-age",
	"no-context-size",
] as const;
type BottomLevel = (typeof BOTTOM_LEVELS)[number];

function atLeastBottom(level: BottomLevel, step: BottomLevel): boolean {
	return BOTTOM_LEVELS.indexOf(level) >= BOTTOM_LEVELS.indexOf(step);
}

function remoteMark(host: string): string {
	if (host.includes("github")) return GLYPHS.github;
	if (host.includes("gitlab")) return GLYPHS.gitlab;
	return GLYPHS.server;
}

/** The fixed part of the left side, and the commit subject that fills what space is left. */
function leftBottom(model: FooterModel, paint: Paint, palette: Palette, level: BottomLevel): { fixed: string; subject: string } {
	const git = model.git;
	const repo = git.kind === "ready" && git.repo.kind === "repo" ? git.repo : undefined;
	const parts: string[] = [];
	const path = abbreviatePath(tildePath(model.cwd, model.home), atLeastBottom(level, "short-path") ? 16 : 32);
	const slash = path.lastIndexOf("/");
	parts.push(
		`${paint(GLYPHS.folder, palette.accent)} ${paint(path.slice(0, slash + 1), palette.dim)}${paint(path.slice(slash + 1), palette.muted, true)}`,
	);
	if (repo?.remote && !atLeastBottom(level, "no-remote")) {
		parts.push(`${paint(remoteMark(repo.remote.host), palette.muted)} ${paint(repo.remote.path, palette.muted)}`);
	}
	if (model.sessionName) parts.push(`${paint(GLYPHS.session, palette.accent)} ${paint(model.sessionName, palette.text)}`);
	let subject = "";
	if (repo?.commit) {
		let commit = `${paint(GLYPHS.commit, palette.dim)} ${paint(repo.commit.hash, palette.hash)}`;
		if (!atLeastBottom(level, "no-age")) commit += ` ${paint(formatAge(model.now - repo.commit.time), palette.dim)}`;
		parts.push(commit);
		subject = repo.commit.subject;
	}
	const separator = ` ${paint(GLYPHS.separator, palette.rail)} `;
	return { fixed: ` ${parts.join(separator)}`, subject };
}

function rightBottom(model: FooterModel, paint: Paint, palette: Palette, level: BottomLevel): string {
	const parts: string[] = [];
	const ttft = model.speed.ttft;
	if (ttft !== undefined && !atLeastBottom(level, "no-ttft")) {
		parts.push(`${paint(GLYPHS.clock, palette.dim)} ${paint(formatSeconds(ttft), palette.muted)}`);
	}
	const { totals } = model;
	if ((totals.input || totals.output) && !atLeastBottom(level, "no-tokens")) {
		const prompt = totals.input + totals.cacheRead + totals.cacheWrite;
		let tokens = `${paint("↑", palette.dim)}${paint(formatTokens(prompt), palette.muted)} ${paint("↓", palette.dim)}${paint(formatTokens(totals.output), palette.muted)}`;
		if (totals.cost > 0) tokens += ` ${paint(`$${totals.cost.toFixed(2)}`, palette.muted)}`;
		parts.push(tokens);
	}
	if (model.cacheHit !== undefined && !atLeastBottom(level, "no-cache")) {
		parts.push(`${paint(GLYPHS.cache, palette.dim)} ${paint(`${Math.round(model.cacheHit * 100)}%`, palette.muted)}`);
	}
	if (!atLeastBottom(level, "no-quota")) {
		for (const quota of model.quotas) {
			parts.push(
				`${paint(GLYPHS.gauge, palette.dim)} ${paint(quota.window, palette.dim)} ${heatBar(paint, palette, quota.used, 5)} ${paint(`${Math.round(quota.used * 100)}%`, heat(palette, quota.used))}`,
			);
		}
	}
	const context = model.context;
	if (context) {
		const share = context.percent === null ? 0 : context.percent / 100;
		const percent = context.percent === null ? "?" : `${Math.round(context.percent)}%`;
		let gauge = `${paint(GLYPHS.database, palette.accent)} ${heatBar(paint, palette, share, atLeastBottom(level, "short-bar") ? 6 : 12)} ${paint(percent, context.percent === null ? palette.dim : heat(palette, share), true)}`;
		if (!atLeastBottom(level, "no-context-size")) {
			gauge += paint(` ${context.tokens === null ? "?" : formatTokens(context.tokens)}/${formatTokens(context.contextWindow)}`, palette.dim);
		}
		parts.push(gauge);
	}
	return `${parts.join(` ${paint(GLYPHS.separator, palette.rail)} `)} `;
}

function bottomLine(model: FooterModel, theme: Theme, palette: Palette, width: number): string {
	const paint = painter(theme);
	for (const level of BOTTOM_LEVELS) {
		const { fixed, subject } = leftBottom(model, paint, palette, level);
		const right = rightBottom(model, paint, palette, level);
		const room = width - visibleWidth(fixed) - visibleWidth(right) - 2;
		if (room < 0) continue;
		const shown = subject && room >= 10 ? ` ${paint(truncateToWidth(subject, room - 1, "…"), palette.muted)}` : "";
		return fixed + shown + " ".repeat(width - visibleWidth(fixed) - visibleWidth(shown) - visibleWidth(right)) + right;
	}
	// Narrower than every level: the context gauge stays whole, the path side is cut.
	const { fixed } = leftBottom(model, paint, palette, "no-context-size");
	const right = rightBottom(model, paint, palette, "no-context-size");
	return truncateToWidth(fixed, Math.max(0, width - visibleWidth(right) - 1), "…") + " " + right;
}

// ── footer and loader ───────────────────────────────────────────────────────────────────────────────────────────

/** Statuses that other extensions set with `ctx.ui.setStatus()`, flattened to one line each. */
function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function renderFooter(model: FooterModel, theme: Theme, width: number): string[] {
	const palette = paletteOf(theme);
	const lines = [topLine(model, theme, palette, width), bottomLine(model, theme, palette, width)];
	if (model.statuses.length > 0) {
		const separator = ` ${theme.style(GLYPHS.separator, { fg: palette.rail })} `;
		lines.push(truncateToWidth(` ${model.statuses.map(sanitize).join(separator)}`, width, "…"));
	}
	return lines.map((line) => truncateToWidth(line, width, ""));
}

const COMET_CELLS = 8;
const COMET_TRAIL = [1, 0.55, 0.3, 0.12];

/**
 * Frames of the working loader: a comet sweeping back and forth along a rail, its tail fading into the rail's color.
 * Built from the theme of the moment, so rebuild them when a run starts.
 */
export function cometFrames(theme: Theme): string[] {
	const palette = paletteOf(theme);
	const positions = [...Array(COMET_CELLS).keys(), ...[...Array(COMET_CELLS - 2).keys()].map((index) => COMET_CELLS - 2 - index)];
	return positions.map((head, step) => {
		const forward = step < COMET_CELLS;
		let frame = "";
		for (let cell = 0; cell < COMET_CELLS; cell++) {
			const behind = forward ? head - cell : cell - head;
			const strength = behind >= 0 && behind < COMET_TRAIL.length ? COMET_TRAIL[behind] : 0;
			frame +=
				strength > 0
					? theme.style(GLYPHS.barFull, { fg: mixColors(palette.rail, palette.accent, strength), bold: behind === 0 })
					: theme.style(GLYPHS.barEmpty, { fg: palette.rail });
		}
		return frame;
	});
}
