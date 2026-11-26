// Tests of reading Magpie's routing decision and the upstream quotas from a response's headers.
//
// Run: node --test ~/.pi/agent/extensions/footer/

import assert from "node:assert/strict";
import { test } from "node:test";

import { readQuotas, readRoute } from "./magpie.ts";

// Headers of a real `group/router` response, as Pi hands them to `after_provider_response` (lowercase names).
const routerResponse = {
	"anthropic-ratelimit-unified-7d-reset": "1795867200",
	"anthropic-ratelimit-unified-7d-utilization": "0.15",
	"anthropic-ratelimit-unified-7d_oi-reset": "1795867200",
	"anthropic-ratelimit-unified-7d_oi-utilization": "0.06",
	"content-type": "text/event-stream; charset=utf-8",
	"x-magpie-model": "claude/claude-opus-5-5",
	"x-magpie-provider": "claude",
};

test("readRoute gives the model and provider Magpie chose", () => {
	assert.deepEqual(readRoute(routerResponse), { model: "claude/claude-opus-5-5", provider: "claude" });
});

test("readRoute gives nothing for a response that Magpie did not route", () => {
	assert.equal(readRoute({ "content-type": "application/json" }), undefined);
	assert.equal(readRoute({ "x-magpie-model": "  " }), undefined);
});

test("readRoute keeps a route whose provider header is missing", () => {
	assert.deepEqual(readRoute({ "x-magpie-model": "codex/gpt-6-luna" }), { model: "codex/gpt-6-luna", provider: undefined });
});

test("readQuotas reads each rolling window with its share used and reset time, shortest window first", () => {
	assert.deepEqual(
		readQuotas({
			...routerResponse,
			"anthropic-ratelimit-unified-5h-utilization": "0.4",
			"anthropic-ratelimit-unified-5h-reset": "1795700000",
		}),
		[
			{ window: "5h", used: 0.4, resetsAt: 1795700000_000 },
			{ window: "7d", used: 0.15, resetsAt: 1795867200_000 },
		],
	);
});

test("readQuotas ignores model-specific sub-windows and values that are not numbers", () => {
	assert.deepEqual(readQuotas({ "anthropic-ratelimit-unified-7d_oi-utilization": "0.06" }), []);
	assert.deepEqual(readQuotas({ "anthropic-ratelimit-unified-7d-utilization": "n/a" }), []);
});

test("readQuotas leaves the reset time out when the header is absent", () => {
	assert.deepEqual(readQuotas({ "anthropic-ratelimit-unified-7d-utilization": "1" }), [{ window: "7d", used: 1, resetsAt: undefined }]);
});
