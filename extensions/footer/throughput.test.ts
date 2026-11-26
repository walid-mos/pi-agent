// Tests of the footer's generation speed: a live estimate while a response streams, the exact rate once it ends.
//
// Run: node --test ~/.pi/agent/extensions/footer/

import assert from "node:assert/strict";
import { test } from "node:test";

import { addDelta, finalRate, liveRate, startGeneration, timeToFirstToken } from "./throughput.ts";

test("finalRate divides the output tokens by the time from the first streamed token to the end", () => {
	let generation = startGeneration(0);
	generation = addDelta(generation, "Hello", 1_000);
	generation = addDelta(generation, " world", 3_000);
	assert.equal(finalRate(generation, 500, 6_000), 100);
});

test("finalRate is unknown when nothing streamed or no token was produced", () => {
	assert.equal(finalRate(startGeneration(0), 500, 6_000), undefined);
	assert.equal(finalRate(addDelta(startGeneration(0), "x", 1_000), 0, 6_000), undefined);
});

test("finalRate is unknown when the whole response arrived at once", () => {
	assert.equal(finalRate(addDelta(startGeneration(0), "everything", 2_000), 300, 2_000), undefined);
});

test("liveRate estimates tokens from the streamed characters, four per token", () => {
	let generation = startGeneration(0);
	generation = addDelta(generation, "a".repeat(1_000), 1_000);
	generation = addDelta(generation, "b".repeat(1_000), 4_000);
	assert.equal(liveRate(generation, 6_000), 100);
});

test("liveRate stays unknown for the first moments of a stream, when one burst would read as a huge speed", () => {
	const generation = addDelta(startGeneration(0), "a".repeat(400), 1_000);
	assert.equal(liveRate(generation, 1_100), undefined);
	assert.equal(liveRate(startGeneration(0), 5_000), undefined);
});

test("timeToFirstToken is the wait between the request and the first streamed token", () => {
	assert.equal(timeToFirstToken(addDelta(startGeneration(500), "x", 2_000)), 1_500);
	assert.equal(timeToFirstToken(startGeneration(500)), undefined);
});

test("addDelta keeps the time of the first token", () => {
	const generation = addDelta(addDelta(startGeneration(0), "a", 1_000), "b", 2_000);
	assert.equal(generation.firstTokenAt, 1_000);
	assert.equal(generation.chars, 2);
});
