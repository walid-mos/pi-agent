/**
 * What a Magpie response says in its headers: the model a routing group (`group/router`, `group/build`...) actually
 * sent the request to, and the share of each upstream subscription window already used.
 *
 * Magpie answers with the group's id in the body (`"model": "group/router"`), so Pi cannot tell the routed model from
 * the stream; it is only in `x-magpie-model` and `x-magpie-provider`. Upstream quota headers (Anthropic's
 * `anthropic-ratelimit-unified-<window>-utilization`) are passed through unchanged.
 */

/** Response headers as Pi gives them to `after_provider_response`: names in lowercase. */
export type Headers = Readonly<Record<string, string>>;

export type Route = { model: string; provider: string | undefined };

/** A rolling usage window of the upstream subscription. */
export type Quota = { window: string; used: number; resetsAt: number | undefined };

export function readRoute(headers: Headers): Route | undefined {
	const model = headers["x-magpie-model"]?.trim();
	if (!model) return undefined;
	return { model, provider: headers["x-magpie-provider"]?.trim() || undefined };
}

const QUOTA = /^anthropic-ratelimit-unified-(\d+)([mhd])-utilization$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Whole-subscription windows only (`5h`, `7d`); model-specific ones such as `7d_oi` are left out. */
export function readQuotas(headers: Headers): Quota[] {
	const quotas: (Quota & { length: number })[] = [];
	for (const [name, value] of Object.entries(headers)) {
		const match = QUOTA.exec(name);
		if (!match) continue;
		const used = Number(value);
		if (value.trim() === "" || !Number.isFinite(used)) continue;
		const window = `${match[1]}${match[2]}`;
		const reset = Number(headers[`anthropic-ratelimit-unified-${window}-reset`]);
		quotas.push({
			window,
			used,
			resetsAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined,
			length: Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS],
		});
	}
	return quotas.sort((a, b) => a.length - b.length).map(({ length: _length, ...quota }) => quota);
}
