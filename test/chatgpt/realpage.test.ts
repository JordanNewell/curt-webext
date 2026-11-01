// @vitest-environment jsdom
// Live-fire: run the walker against a real chatgpt.com DOM dump.
// Opt-in only — point CURT_DUMP at a saved page (popup "Download DOM dump"):
//   CURT_DUMP=~/Downloads/curt-debug-dom-chatgpt.com.html npx vitest run test/chatgpt/realpage.test.ts
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { extractConversation } from "../../src/adapters/chatgpt/content.js";

const DUMP = process.env.CURT_DUMP ?? "";

describe.skipIf(!DUMP || !existsSync(DUMP))("real chatgpt.com page (CURT_DUMP)", () => {
	it("extracts messages from the live DOM", () => {
		const html = readFileSync(DUMP, "utf-8");
		const dom = new JSDOM(html);
		const res = extractConversation(dom.window.document, {
			now: 1730600000000,
			location: { href: dom.window.location.href, pathname: dom.window.location.pathname },
		});
		expect(res.conversation.messages.length).toBeGreaterThan(0);
	});
});
