/**
 * DOM -> model extraction helpers shared by adapters.
 *
 * Pure functions only: adapters that run as MV3 content scripts must stay
 * single-file (Chrome content scripts cannot resolve extension-relative
 * imports), so each adapter inlines what it needs and imports at most
 * `type`-only symbols from core — everything here is also usable directly
 * by tests and by DOM-privileged contexts (the popup).
 */

import type { CurtRole } from "./types.js";

/** Collapse CRLF/CR to LF, non-breaking spaces to spaces, trim ends. */
export function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();
}

/**
 * Best-effort plain-text extraction from an element: `innerText` (layout
 * aware, keeps block-level line breaks) when available, `textContent`
 * otherwise (jsdom and non-HTML documents).
 */
export function elementText(el: Element): string {
	const htmlEl = el as HTMLElement;
	if (typeof htmlEl.innerText === "string") return htmlEl.innerText;
	return el.textContent ?? "";
}

/**
 * Coerce an observed timestamp to epoch milliseconds. Accepts Date objects,
 * numeric epoch ms, and ISO-8601 / RFC-2822 strings; returns `fallback`
 * (default 0) for anything unparseable.
 */
export function toEpochMs(value: unknown, fallback = 0): number {
	if (value instanceof Date) {
		const t = value.getTime();
		return Number.isFinite(t) ? t : fallback;
	}
	if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
	if (typeof value === "string") {
		if (/^\d+$/.test(value)) return Number(value);
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

/**
 * Infer a .curt role from loose page hints when no explicit role attribute
 * exists. Returns undefined when nothing in the hints identifies a role —
 * callers should then skip the node rather than guess.
 */
export function inferRole(hints: {
	attr?: string | undefined;
	className?: string | undefined;
	ariaLabel?: string | undefined;
}): CurtRole | undefined {
	const haystack = [hints.attr, hints.className, hints.ariaLabel]
		.filter((s): s is string => typeof s === "string")
		.join(" ")
		.toLowerCase();
	if (/\buser\b|\bhuman\b/.test(haystack)) return "user";
	if (/\bassistant\b|\bbot\b|\bai\b|\bmodel\b/.test(haystack)) return "assistant";
	if (/\bsystem\b/.test(haystack)) return "system";
	if (/\btool\b/.test(haystack)) return "tool";
	return undefined;
}
