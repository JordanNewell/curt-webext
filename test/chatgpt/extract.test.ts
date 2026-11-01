// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseCurt } from "curt-format";
import { extractConversation } from "../../src/adapters/chatgpt/content.js";
import { serializeCurt } from "../../src/core/serialize.js";
import type { ExtractResult } from "../../src/core/types.js";

const NOW = 1730600000000;

function turn(role: string, text: string, id?: string): string {
	const idAttr = id ? ` data-message-id="${id}"` : "";
	return `<div data-message-author-role="${role}"${idAttr}><div>${text}</div></div>`;
}

function page(body: string, title = "My chat | ChatGPT"): Document {
	return new DOMParser().parseFromString(
		`<html><head><title>${title}</title></head><body>${body}</body></html>`,
		"text/html",
	);
}

const LOC = { href: "https://chatgpt.com/c/abc123-def456-7890", pathname: "/c/abc123-def456-7890" };

describe("extractConversation (chatgpt)", () => {
	it("walks user/assistant turns in document order", () => {
		const doc = page(
			turn("user", "What is .curt?") +
				turn("assistant", "An open conversation format.", "msg-2") +
				turn("user", "Thanks") +
				turn("assistant", "You're welcome.", "msg-4"),
		);
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		expect(result.conversation.messages[0].content).toBe("What is .curt?");
		expect(result.skippedUnparseable).toBe(0);
	});

	it("uses data-message-id and falls back to positional ids", () => {
		const doc = page(turn("user", "hi") + turn("assistant", "hello", "msg-9"));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages[0].id).toBe("chatgpt-msg-0");
		expect(result.conversation.messages[1].id).toBe("msg-9");
	});

	it("derives conversation id from /c/<uuid> and strips the title suffix", () => {
		const result = extractConversation(page("x"), { now: NOW, location: LOC });
		expect(result.conversation.id).toBe("chatgpt_abc123-def456-7890");
		expect(result.conversation.title).toBe("My chat");
		expect(result.conversation.provider).toBe("openai");
		expect(result.sourceUrl).toBe(LOC.href);
	});

	it("returns empty title for an untitled thread", () => {
		const result = extractConversation(page("x", "ChatGPT"), { now: NOW, location: LOC });
		expect(result.conversation.title).toBe("");
	});

	it("counts and skips unparseable nodes without aborting", () => {
		const doc = page(
			turn("user", "one") +
				`<div data-message-author-role="wizard">weird</div>` +
				`<div data-message-author-role="assistant"></div>` +
				turn("assistant", "two", "msg-3"),
		);
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages.map((m) => m.content)).toEqual(["one", "two"]);
		expect(result.skippedUnparseable).toBe(2);
	});

	it("deduplicates repeated data-message-id values", () => {
		const doc = page(turn("assistant", "first", "dup-1") + turn("assistant", "second", "dup-1"));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages).toHaveLength(1);
		expect(result.conversation.messages[0].content).toBe("first");
		expect(result.skippedDuplicates).toBe(1);
	});

	it("falls back to a time-derived id off a /c/ URL", () => {
		const result = extractConversation(page("x"), {
			now: NOW,
			location: { href: "https://chatgpt.com/", pathname: "/" },
		});
		expect(result.conversation.id).toBe(`chatgpt_${NOW.toString(36)}`);
	});

	it("serializes to a body parseCurt accepts (end-to-end)", () => {
		const doc = page(turn("user", "ping") + turn("assistant", "pong", "msg-2"));
		const { conversation } = extractConversation(doc, { now: NOW, location: LOC });
		const parsed = parseCurt(serializeCurt(conversation, "curt-webext@0.1.0"));
		expect(parsed).toEqual(conversation);
	});

	it("attaches model when the page exposes data-message-model", () => {
		const doc = page(
			`<div data-message-author-role="assistant" data-message-id="m1" data-message-model="gpt-4o">hey</div>`,
		);
		const result: ExtractResult = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages[0].model).toBe("gpt-4o");
	});
});
