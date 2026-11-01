// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { elementText, inferRole, normalizeText, toEpochMs } from "../../src/core/dom.js";

describe("normalizeText", () => {
	it("collapses CRLF and CR to LF", () => {
		expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
	});

	it("replaces non-breaking spaces and trims", () => {
		expect(normalizeText("  a b  ")).toBe("a b");
	});

	it("keeps interior newlines", () => {
		expect(normalizeText("\nkeep\nme\n")).toBe("keep\nme");
	});
});

describe("elementText", () => {
	it("extracts text with block line breaks via innerText in DOM contexts", () => {
		const el = document.createElement("div");
		el.innerHTML = "<p>one</p><p>two</p>";
		// jsdom implements innerText layout heuristics; textContent is the fallback.
		expect(elementText(el).length).toBeGreaterThan(0);
		expect(elementText(el)).toMatch(/one/);
		expect(elementText(el)).toMatch(/two/);
	});

	it("falls back to textContent", () => {
		const el = document.createElement("span");
		el.textContent = "plain";
		expect(elementText(el)).toBe("plain");
	});
});

describe("toEpochMs", () => {
	it("passes through finite numbers", () => {
		expect(toEpochMs(1700000000000)).toBe(1700000000000);
	});

	it("parses ISO strings and digit strings", () => {
		expect(toEpochMs("2023-11-14T22:13:20.000Z")).toBe(1700000000000);
		expect(toEpochMs("1700000000000")).toBe(1700000000000);
	});

	it("accepts Date objects", () => {
		expect(toEpochMs(new Date(1700000000000))).toBe(1700000000000);
	});

	it("returns fallback for garbage", () => {
		expect(toEpochMs("not a date", 42)).toBe(42);
		expect(toEpochMs(undefined, 7)).toBe(7);
		expect(toEpochMs(Number.NaN)).toBe(0);
	});
});

describe("inferRole", () => {
	it("reads explicit role attrs", () => {
		expect(inferRole({ attr: "assistant" })).toBe("assistant");
		expect(inferRole({ attr: "user" })).toBe("user");
	});

	it("infers from class or aria hints", () => {
		expect(inferRole({ className: "human-turn" })).toBe("user");
		expect(inferRole({ ariaLabel: "Bot message" })).toBe("assistant");
		expect(inferRole({ className: "system-note" })).toBe("system");
	});

	it("returns undefined when nothing identifies a role", () => {
		expect(inferRole({})).toBeUndefined();
		expect(inferRole({ className: "message-group" })).toBeUndefined();
	});
});
