// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseCurt } from "curt-format";
import { extractConversation } from "../../src/adapters/chatgpt/content.js";
import { serializeCurt } from "../../src/core/serialize.js";
import type { ExtractResult } from "../../src/core/types.js";

const NOW = 1730600000000;

/**
 * 2026-11 DOM: turn container carries data-turn-key; data-conversation-role
 * nodes are LABEL headers — the message content is the sibling that follows.
 */
function turn(role: string, text: string, id?: string): string {
	const key = id ?? `turn-${Math.random().toString(36).slice(2, 10)}`;
	const label = role === "user" ? "You said:" : "ChatGPT said:";
	return (
		`<div data-turn-key="${key}">` +
		`<div data-conversation-role="${role}"><span class="print:group:conversation-print:sr-only">${label}</span></div>` +
		`<div class="group/${role}-message">` +
		`<div class="whitespace-pre-wrap"><p>${text}</p></div>` +
		`<button aria-label="Copy">Copy</button>` +
		`</div>` +
		`</div>`
	);
}

/** One turn container holding a full exchange (user label+bubble, then assistant). */
function fullTurn(userText: string, assistantText: string, id?: string): string {
	const key = id ?? `turn-${Math.random().toString(36).slice(2, 10)}`;
	return (
		`<div data-turn-key="${key}">` +
		`<div data-conversation-role="user"><span class="print:sr-only">You said:</span></div>` +
		`<div><p>${userText}</p></div>` +
		`<div data-conversation-role="assistant"><span class="print:sr-only">ChatGPT said:</span></div>` +
		`<div><p>${assistantText}</p><div class="flex"><button>Copy</button></div></div>` +
		`<div data-testid="thread-scroll-footer">ChatGPT can make mistakes. Check important info.</div>` +
		`</div>`
	);
}

/** Legacy era fixture: data-message-author-role + data-message-id. */
function legacyTurn(role: string, text: string, id?: string): string {
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

	it("uses data-turn-key and falls back to positional ids", () => {
		const doc = page(turn("user", "hi") + turn("assistant", "hello", "turn-9"));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages[0].id).not.toBe("chatgpt-msg-0");
		expect(result.conversation.messages[1].id).toBe("turn-9-0");
	});

	it("strips sr-only labels and action buttons from content", () => {
		const doc = page(turn("user", "hello world"));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages[0].content).toBe("hello world");
		expect(result.conversation.messages[0].content).not.toContain("You said");
		expect(result.conversation.messages[0].content).not.toContain("Copy");
	});

	it("splits one turn container into user+assistant segments in order", () => {
		const doc = page(fullTurn("what is curt?", "an open format."));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(result.conversation.messages.map((m) => m.content)).toEqual([
			"what is curt?",
			"an open format.",
		]);
		expect(result.conversation.messages[0].id).toMatch(/-0$/);
		expect(result.conversation.messages[1].id).toMatch(/-1$/);
		expect(result.skippedUnparseable).toBe(0);
	});

	it("drops the scroll-footer disclaimer from turn content", () => {
		const doc = page(fullTurn("q", "a"));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		for (const m of result.conversation.messages) {
			expect(m.content).not.toContain("ChatGPT can make mistakes");
		}
	});

	it("still walks the legacy data-message-author-role DOM", () => {
		const doc = page(legacyTurn("user", "old user") + legacyTurn("assistant", "old bot", "msg-2"));
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages.map((m) => m.content)).toEqual(["old user", "old bot"]);
		expect(result.conversation.messages[1].id).toBe("msg-2");
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
				`<div data-turn-key="turn-weird">` +
				`<div data-conversation-role="wizard">weird label</div><div>weird content</div>` +
				`<div data-conversation-role="assistant"></div>` +
				`</div>` +
				turn("assistant", "two", "turn-3"),
		);
		const result = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages.map((m) => m.content)).toEqual(["one", "two"]);
		// unknown-role label drops its segment; empty assistant label = 1 skip
		expect(result.skippedUnparseable).toBe(1);
	});

	it("deduplicates repeated turn keys", () => {
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

	it("attaches model when the page exposes data-message-model (legacy)", () => {
		const doc = page(
			`<div data-message-author-role="assistant" data-message-id="m1" data-message-model="gpt-4o">hey</div>`,
		);
		const result: ExtractResult = extractConversation(doc, { now: NOW, location: LOC });
		expect(result.conversation.messages[0].model).toBe("gpt-4o");
	});
});
