/**
 * The ceiling picker opened by /ceiling: any value from the minimum to what the model's window allows, by steps of
 * 1k, 10k or 100k, through a list of stops, or typed (300k, 1.2m). The thresholds that follow from the value are
 * shown live on a bar of the model's window. Every color comes from the theme.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import { formatTokens, MIN_CEILING, parseTokenCount, type Thresholds } from "./config.ts";

export type Scope = "session" | "default";
export type Choice = { ceiling: number; scope: Scope };

export type PickerInput = {
	modelLabel: string;
	contextWindow: number;
	maxCeiling: number;
	piThreshold: number;
	initial: number;
	contextTokens: number | undefined;
	sessionHasOwn: boolean;
	thresholdsOf: (ceiling: number) => Thresholds;
};

const STOPS = [32_000, 48_000, 64_000, 96_000, 128_000, 160_000, 200_000, 256_000, 300_000, 400_000, 500_000, 640_000, 800_000];

export class CeilingPicker implements Component {
	private value: number;
	private typed = "";
	private scope: Scope = "session";

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly input: PickerInput,
		private readonly done: (choice: Choice | undefined) => void,
	) {
		this.value = this.clamp(input.initial);
	}

	private clamp(value: number): number {
		return Math.min(this.input.maxCeiling, Math.max(MIN_CEILING, Math.round(value / 1_000) * 1_000));
	}

	private stops(): number[] {
		return [...STOPS.filter((stop) => stop < this.input.maxCeiling), this.input.maxCeiling];
	}

	private set(value: number): void {
		this.value = this.clamp(value);
		this.typed = "";
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		const steps: [string, number][] = [
			[Key.left, -1_000],
			[Key.right, 1_000],
			[Key.down, -10_000],
			[Key.up, 10_000],
			[Key.pageDown, -100_000],
			[Key.pageUp, 100_000],
		];
		for (const [key, step] of steps) if (matchesKey(data, key as never)) return this.set(this.value + step);
		if (matchesKey(data, Key.home)) return this.set(MIN_CEILING);
		if (matchesKey(data, Key.end)) return this.set(this.input.maxCeiling);
		if (data === "[" || data === "]") {
			const stops = this.stops();
			const next = data === "]" ? stops.find((stop) => stop > this.value) : [...stops].reverse().find((stop) => stop < this.value);
			return this.set(next ?? this.value);
		}
		if (matchesKey(data, Key.tab)) {
			this.scope = this.scope === "session" ? "default" : "session";
			return this.tui.requestRender();
		}
		if (matchesKey(data, Key.backspace)) {
			this.typed = this.typed.slice(0, -1);
			return this.tui.requestRender();
		}
		if (matchesKey(data, Key.escape)) {
			if (this.typed) {
				this.typed = "";
				return this.tui.requestRender();
			}
			return this.done(undefined);
		}
		if (matchesKey(data, Key.enter)) {
			if (this.typed) {
				const parsed = parseTokenCount(this.typed);
				if (parsed === undefined) return; // the line already says the text is not a count
				return this.set(parsed);
			}
			return this.done({ ceiling: this.value, scope: this.scope });
		}
		if (/^[0-9.kmKM_]$/.test(data)) {
			this.typed += data.toLowerCase();
			this.tui.requestRender();
		}
	}

	invalidate(): void {}

	/** One line of the window, by ranges: in context now, below pruning, pruning to summary, summary to ceiling, beyond. */
	private bar(width: number, thresholds: Thresholds): string {
		const { theme, input } = this;
		const cell = (tokens: number) => Math.round((tokens / input.contextWindow) * width);
		const now = input.contextTokens === undefined ? -1 : cell(input.contextTokens);
		const marks = { prune: cell(thresholds.prune), summary: cell(thresholds.summary), ceiling: cell(thresholds.ceiling) };
		let out = "";
		for (let index = 0; index < width; index++) {
			if (index === marks.ceiling) out += theme.fg("accent", "┃");
			else if (index < now) out += theme.fg("text", "█");
			else if (index < marks.prune) out += theme.fg("dim", "━");
			else if (index < marks.summary) out += theme.fg("warning", "━");
			else if (index < marks.ceiling) out += theme.fg("accent", "━");
			else out += theme.fg("borderMuted", "─");
		}
		return out;
	}

	render(width: number): string[] {
		const { theme, input } = this;
		const thresholds = input.thresholdsOf(this.value);
		const pad = "  ";
		const barWidth = Math.max(20, Math.min(80, width - 4));
		const label = (name: string) => theme.fg("muted", name.padEnd(22));
		const typedValue = this.typed ? parseTokenCount(this.typed) : undefined;
		const typedLine = this.typed
			? `${theme.fg("accent", `typed: ${this.typed}`)} ${typedValue === undefined ? theme.fg("error", "not a token count") : theme.fg("dim", `Enter sets ${formatTokens(this.clamp(typedValue))}${this.clamp(typedValue) !== typedValue ? " (clamped)" : ""}`)}`
			: "";
		const scopeText =
			this.scope === "session"
				? `${theme.fg("accent", "● this session")}  ${theme.fg("dim", "○ default for every session")}`
				: `${theme.fg("dim", "○ this session")}  ${theme.fg("accent", "● default for every session")}`;
		const lines = [
			theme.fg("borderAccent", "─".repeat(Math.max(0, width))),
			`${pad}${theme.bold("Context ceiling")}  ${theme.fg("dim", `${input.modelLabel} · window ${formatTokens(input.contextWindow)}`)}`,
			"",
			`${pad}${this.bar(barWidth, thresholds)}`,
			`${pad}${theme.fg("dim", "━ pruning off")}  ${theme.fg("warning", "━ pruning")}  ${theme.fg("accent", "━ checkpoint written in the background  ┃ ceiling")}${input.contextTokens === undefined ? "" : `  ${theme.fg("text", "█ in context now")}`}`,
			"",
			`${pad}${label("Ceiling")}${theme.fg("accent", theme.bold(formatTokens(this.value)))}  ${theme.fg("dim", `(${MIN_CEILING / 1000}k – ${formatTokens(input.maxCeiling)})`)}  ${typedLine}`,
			`${pad}${label("Prune tool results")}from ${formatTokens(thresholds.prune)}, again every +${formatTokens(thresholds.pruneStep)}`,
			`${pad}${label("Background checkpoint")}from ${formatTokens(thresholds.summary)}`,
			`${pad}${label("Kept verbatim")}last ${formatTokens(thresholds.tail)}; state note ≤ ${formatTokens(thresholds.noteTokens)}, ledger ≤ ${formatTokens(thresholds.ledgerTokens)}`,
			`${pad}${label("Pi's own compaction")}${formatTokens(input.piThreshold)} ${theme.fg("dim", "(handled by checkpoint too)")}`,
			`${pad}${label("In context now")}${input.contextTokens === undefined ? theme.fg("dim", "unknown until the next response") : formatTokens(input.contextTokens)}`,
			"",
			`${pad}${label("Applies to")}${scopeText}${input.sessionHasOwn && this.scope === "default" ? theme.fg("dim", "  (clears this session's own value)") : ""}`,
			"",
			`${pad}${theme.fg("dim", "←/→ ±1k   ↑/↓ ±10k   PgUp/PgDn ±100k   [ ] stops   Home/End min/max")}`,
			`${pad}${theme.fg("dim", "type 300k or 1.2m   Tab scope   Enter apply   Esc cancel")}`,
			theme.fg("borderAccent", "─".repeat(Math.max(0, width))),
		];
		return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width) : line));
	}
}
