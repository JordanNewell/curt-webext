// @vitest-environment jsdom
// Live-fire against a real chatgpt.com DOM dump (manual debug artifact).
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { extractConversation } from "../../src/adapters/chatgpt/content.js";

const DUMP = "C:/Users/jrnew/Downloads/curt-debug-dom-chatgpt.com.html";

describe("real chatgpt.com page (dumped)", () => {
	it.skipIf(!existsSync(DUMP))("extracts messages from the live DOM", () => {
		const html = readFileSync(DUMP, "utf-8");
		const dom = new JSDOM(html, { url: "https://chatgpt.com/c/6ad362a9-b63c-83ea-adb2-88544afac341" });
		const doc = dom.window.document;
		const nodes = doc.querySelectorAll("[data-conversation-role]");
		console.log("role nodes:", nodes.length);
		for (const n of Array.from(nodes)) {
			console.log("  role:", n.getAttribute("data-conversation-role"),
				"| turnKey:", n.closest("[data-turn-key]")?.getAttribute("data-turn-key") ?? null,
				"| textLen:", n.textContent?.length,
				"| starts:", JSON.stringify((n.textContent ?? "").slice(0, 60)));
		}
		const res = extractConversation(doc, {
			now: 1730600000000,
			location: { href: dom.window.location.href, pathname: dom.window.location.pathname },
		});
		console.log("extracted:", res.conversation.messages.length, "skipped:", res.skippedUnparseable);
		for (const m of res.conversation.messages) {
			console.log(`  [${m.role}] id=${m.id} ::`, JSON.stringify(m.content.slice(0, 100)));
		}
		expect(res.conversation.messages.length).toBeGreaterThan(0);
	});
});
