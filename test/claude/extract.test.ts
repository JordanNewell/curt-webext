import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { extractConversation } from "../../src/adapters/claude/content.js";

function doc(html: string): Document {
	return new JSDOM(html).window.document;
}

const NOW = 1_700_000_000_000;
const CONV_ID = "01234567-89ab-cdef-0123-456789abcdef";
const OPTS = {
	now: NOW,
	location: { href: `https://claude.ai/chat/${CONV_ID}`, pathname: `/chat/${CONV_ID}` },
	title: "Pricing strategy - Claude",
};

describe("extractConversation", () => {
	it("extracts an alternating user/assistant conversation in DOM order", () => {
		const document = doc(`
			<main>
				<div data-testid="user-message">What is a curt file?</div>
				<div data-testid="assistant-response"><p>It is a single-file conversation format.</p></div>
				<div data-testid="user-message">Show an example</div>
				<div data-testid="assistant-response"><p>{"curt": "curtis-conversation"}</p></div>
			</main>
		`);
		const result = extractConversation(document, OPTS);

		expect(result.conversation.messages.map((m) => m.role)).toEqual([
			"user", "assistant", "user", "assistant",
		]);
		expect(result.conversation.messages[0].content).toBe("What is a curt file?");
		expect(result.conversation.messages[1].content).toBe(
			"It is a single-file conversation format.",
		);
		expect(result.conversation.messages[1].content).not.toContain("<p>");
		expect(result.skippedUnparseable).toBe(0);
		expect(result.skippedDuplicates).toBe(0);
		expect(result.sourceUrl).toBe(OPTS.location.href);
	});

	it("matches the data-test-id spelling variant too", () => {
		const document = doc(`
			<main>
				<div data-test-id="user-message">hi</div>
				<div data-test-id="assistant-response">hello</div>
			</main>
		`);
		const result = extractConversation(document, OPTS);
		expect(result.conversation.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});

	it("keeps document order when assistant turns come first", () => {
		const document = doc(`
			<main>
				<div data-testid="assistant-response">Before you ask anything.</div>
				<div data-testid="user-message">hi</div>
			</main>
		`);
		const result = extractConversation(document, OPTS);
		expect(result.conversation.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
	});

	it("falls back to .font-claude-message when testids are absent", () => {
		const document = doc(`
			<main>
				<div><span>What about firefox?</span></div>
				<div><div class="font-claude-message">Fully supported.</div></div>
				<div><span>thanks</span></div>
			</main>
		`);
		const result = extractConversation(document, OPTS);
		expect(result.conversation.messages.map((m) => m.role)).toEqual([
			"user", "assistant", "user",
		]);
		expect(result.conversation.messages[1].content).toBe("Fully supported.");
	});

	it("counts unparseable/empty nodes instead of aborting", () => {
		const document = doc(`
			<main>
				<div data-testid="user-message"></div>
				<div data-testid="user-message">still here</div>
				<div data-testid="assistant-response"><button>Retry</button></div>
				<div data-testid="assistant-response">answer</div>
			</main>
		`);
		const result = extractConversation(document, OPTS);
		expect(result.conversation.messages).toHaveLength(2);
		expect(result.conversation.messages[0].content).toBe("still here");
		expect(result.conversation.messages[1].content).toBe("answer");
		expect(result.skippedUnparseable).toBe(2);
	});

	it("keeps the innermost matching node and counts the wrapper as a duplicate", () => {
		const document = doc(`
			<main>
				<div data-testid="assistant-response">
					<div data-testid="assistant-response">inner only</div>
				</div>
			</main>
		`);
		const result = extractConversation(document, OPTS);
		expect(result.conversation.messages).toHaveLength(1);
		expect(result.conversation.messages[0].content).toBe("inner only");
		expect(result.skippedDuplicates).toBe(1);
	});

	it("returns zero messages when the page has no conversation", () => {
		const document = doc("<main><nav>menu</nav></main>");
		const result = extractConversation(document, OPTS);
		expect(result.conversation.messages).toHaveLength(0);
		expect(result.skippedUnparseable).toBe(0);
	});

	it("stamps export time on every message (DOM has no per-message timestamps)", () => {
		const document = doc(`
			<main>
				<div data-testid="user-message">a</div>
				<div data-testid="assistant-response">b</div>
			</main>
		`);
		const result = extractConversation(document, OPTS);
		for (const m of result.conversation.messages) expect(m.timestamp).toBe(NOW);
		expect(result.conversation.createdAt).toBe(NOW);
		expect(result.conversation.updatedAt).toBe(NOW);
	});

	it("derives ids deterministically from the conversation id", () => {
		const document = doc(`<main><div data-testid="user-message">a</div></main>`);
		const result = extractConversation(document, OPTS);
		expect(result.conversation.id).toBe(`claude_${CONV_ID}`);
		expect(result.conversation.messages[0].id).toBe(`claude_${CONV_ID}-m0`);
	});

	it("falls back to a time-derived id outside /chat/<uuid> URLs", () => {
		const document = doc(`<main><div data-testid="user-message">a</div></main>`);
		const result = extractConversation(document, {
			now: NOW,
			location: { href: "https://claude.ai/new", pathname: "/new" },
		});
		expect(result.conversation.id).toBe(`claude_${NOW.toString(36)}`);
	});

	it("tags the provider", () => {
		const document = doc(`<main><div data-testid="user-message">a</div></main>`);
		expect(extractConversation(document, OPTS).conversation.provider).toBe("anthropic");
	});
});

describe("conversationTitle", () => {
	it("strips the app suffix and trims", () => {
		const document = doc("<main></main>");
		expect(extractConversation(document, { ...OPTS, title: "Pricing strategy - Claude" }).conversation.title).toBe("Pricing strategy");
		expect(extractConversation(document, { ...OPTS, title: "Pricing strategy | Claude" }).conversation.title).toBe("Pricing strategy");
		expect(extractConversation(document, { ...OPTS, title: "  untitled chat  " }).conversation.title).toBe("untitled chat");
		expect(extractConversation(document, { ...OPTS, title: "Claude" }).conversation.title).toBe("");
	});
});

describe("normalize (block-aware text extraction)", () => {
	it("joins paragraphs with a newline", () => {
		const document = doc(`<main><div data-testid="user-message"><p>first</p><p>second</p></div></main>`);
		const [msg] = extractConversation(document, OPTS).conversation.messages;
		expect(msg.content).toBe("first\nsecond");
	});

	it("keeps code blocks verbatim", () => {
		const document = doc(
			`<main><div data-testid="assistant-response"><pre><code>const x = 1;\n\n\nif (x) {\n  go();\n}</code></pre></div></main>`,
		);
		const [msg] = extractConversation(document, OPTS).conversation.messages;
		expect(msg.content).toContain("const x = 1;\n\n\nif (x)");
	});

	it("skips script, style, and button content", () => {
		const document = doc(
			`<main><div data-testid="user-message">visible<script>evil()</script><style>.x{}</style><button>Copy</button></div></main>`,
		);
		const [msg] = extractConversation(document, OPTS).conversation.messages;
		expect(msg.content).toBe("visible");
	});

	it("treats br as a line break and preserves inline flow", () => {
		const document = doc(
			`<main><div data-testid="user-message">one<br>two <strong>bold</strong></div></main>`,
		);
		const [msg] = extractConversation(document, OPTS).conversation.messages;
		expect(msg.content).toBe("one\ntwo bold");
	});

	it("does not stack separators for nested blocks", () => {
		const document = doc(`<main><div data-testid="user-message"><div><div><p>deep</p></div></div></div></main>`);
		const [msg] = extractConversation(document, OPTS).conversation.messages;
		expect(msg.content).toBe("deep");
	});
});
