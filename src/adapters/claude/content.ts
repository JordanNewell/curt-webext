/**
 * Claude.ai adapter: DOM walker for claude.ai conversation threads.
 *
 * MV3 CONTENT-SCRIPT CONSTRAINT: content scripts cannot resolve
 * extension-relative module imports, so this file is deliberately
 * self-contained — the walker lives here alongside the message listener.
 * The only import is type-only and erased at compile time.
 *
 * Selector strategy: prefer claude.ai's data attributes
 * (`data-testid="user-message"` / `data-testid="assistant-response"`,
 * matching both `data-testid` and `data-test-id` spellings the site has
 * used), falling back to the `.font-claude-message` markdown container
 * for older renderings. Never rely on the generated class-name soup
 * otherwise. Degrade gracefully: unparseable nodes are counted
 * (ExtractResult.skippedUnparseable) and the export continues — the
 * walker never aborts mid-conversation.
 *
 * KNOWN LIMITS: claude.ai's DOM exposes neither per-message timestamps
 * (export time is stamped on every message) nor the selected model id
 * (`model` stays unset). Verify selectors against a live session before
 * shipping; claude.ai is a React app with no stable contract.
 */

import type { CurtConversation, CurtMessage, ExtractResult } from "../../core/types.js";

const USER_SELECTOR =
	'[data-testid="user-message"],[data-test-id="user-message"]';
const ASSISTANT_SELECTOR =
	'[data-testid="assistant-response"],[data-test-id="assistant-response"]';
const ASSISTANT_FALLBACK_SELECTOR = ".font-claude-message";
const PROVIDER = "anthropic";

/** Block-level elements get one newline separator; nested blocks don't stack. */
const BLOCK_TAGS = new Set([
	"ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIALOG",
	"DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
	"H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "LI", "MAIN",
	"NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL",
]);

/** Elements that never contribute message text. */
const SKIP_TAGS = new Set([
	"SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON", "CANVAS",
]);

interface ExtractOptions {
	/** Overrides Date.now() (tests). */
	now?: number;
	/** Overrides location (tests). */
	location?: { href: string; pathname: string };
	/** Overrides document.title (tests). */
	title?: string;
}

interface TurnNode {
	role: "user" | "assistant";
	el: Element;
}

function isElement(node: Node): node is Element {
	return node.nodeType === 1; // Node.ELEMENT_NODE
}

function boundary(out: string[]): void {
	// One newline per run of block boundaries.
	const last = out[out.length - 1];
	if (last !== undefined && last.endsWith("\n")) return;
	out.push("\n");
}

function collect(node: Node, out: string[]): void {
	if (isElement(node)) {
		const tag = node.tagName.toUpperCase();
		if (SKIP_TAGS.has(tag)) return;
		if (tag === "PRE") {
			// Verbatim: no separators inside code, no rewriting after.
			out.push(node.textContent ?? "");
			boundary(out);
			return;
		}
		if (tag === "BR") {
			out.push("\n");
			return;
		}
		for (const child of Array.from(node.childNodes)) collect(child, out);
		if (BLOCK_TAGS.has(tag)) boundary(out);
		return;
	}
	if (node.nodeType === 3) out.push(node.nodeValue ?? ""); // TEXT_NODE
}

/**
 * Block-aware plain text. Deliberately avoids `innerText`: it depends on
 * CSS layout and is not implemented by jsdom, so code using it cannot run
 * in tests.
 */
function normalize(node: Element): string {
	const parts: string[] = [];
	collect(node, parts);
	return parts
		.join("")
		.replace(/[ \t]+\n/g, "\n") // trailing whitespace before hard breaks
		.trim();
}

/** Drop matches that contain another match — keep the innermost node. */
function innermost(els: Element[], selector: string): Element[] {
	return els.filter((el) => el.querySelector(selector) === null);
}

/** Document-order sort; falls back to DOM order when comparison is equal. */
function documentOrder(els: Element[]): Element[] {
	const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
	return els.sort((a, b) => {
		const cmp = a.compareDocumentPosition(b);
		// b follows a -> a first; otherwise b first.
		return cmp & FOLLOWING ? -1 : 1;
	});
}

function findTurns(root: ParentNode, duplicates: { count: number }): TurnNode[] {
	const userAll = Array.from(root.querySelectorAll(USER_SELECTOR));
	const user = innermost(userAll, USER_SELECTOR).map((el) => ({
		role: "user" as const,
		el,
	}));
	duplicates.count += userAll.length - user.length;

	// Prefer the assistant testid when present; .font-claude-message is the
	// fallback for older renderings that lack it. The two can nest, so the
	// sets are never mixed.
	const responses = Array.from(root.querySelectorAll(ASSISTANT_SELECTOR));
	const assistantEls =
		responses.length > 0 ? innermost(responses, ASSISTANT_SELECTOR) : Array.from(root.querySelectorAll(ASSISTANT_FALLBACK_SELECTOR));
	duplicates.count += responses.length - (responses.length > 0 ? assistantEls.length : 0);
	const assistant = assistantEls.map((el) => ({ role: "assistant" as const, el }));

	// User testids present: merge both sets and sort into visual order.
	if (user.length > 0) {
		return documentOrder([...user, ...assistant].map((t) => t.el)).map(
			(el) => ({
				role: user.some((t) => t.el === el)
					? ("user" as const)
					: ("assistant" as const),
				el,
			}),
		);
	}

	// Fallback: no user testids at all. Classify direct children of the
	// turn-list container: a child holding an assistant marker is an
	// assistant turn, any other child is a user turn.
	if (assistant.length === 0) return [];
	const turns: TurnNode[] = [];
	const seen = new Set<Element>();
	for (const marker of assistant) {
		const host = marker.el.parentElement;
		const list = host?.parentElement;
		if (!host || !list) continue;
		for (const child of Array.from(list.children)) {
			if (seen.has(child)) continue;
			seen.add(child);
			if (
				child.querySelector(ASSISTANT_SELECTOR) ||
				child.querySelector(ASSISTANT_FALLBACK_SELECTOR)
			) {
				turns.push({ role: "assistant", el: child });
			} else {
				turns.push({ role: "user", el: child });
			}
		}
	}
	return turns;
}

/** "0123..." from /chat/<uuid> -> "claude_0123..."; else time-derived. */
function conversationId(pathname: string, now: number): string {
	const match = /\/chat\/([0-9a-f-]{8,})/i.exec(pathname);
	if (match) return `claude_${match[1]}`;
	return `claude_${now.toString(36)}`;
}

/** Strip the "- Claude" / "| Claude" site suffix; the app alone -> "". */
function conversationTitle(title: string): string {
	const cleaned = title.replace(/\s*[-|]\s*Claude\s*$/i, "").trim();
	return cleaned === "Claude" ? "" : cleaned;
}

/** Extract the conversation currently rendered in `doc`. Never throws. */
export function extractConversation(doc: Document, options: ExtractOptions = {}): ExtractResult {
	const now = options.now ?? Date.now();
	const loc = options.location ?? doc.defaultView?.location ?? { href: "", pathname: "/" };
	const title = options.title ?? doc.title;

	let skippedUnparseable = 0;
	const duplicates = { count: 0 };
	const messages: CurtMessage[] = [];
	const conversationIdValue = conversationId(loc.pathname, now);

	let index = 0;
	for (const turn of findTurns(doc, duplicates)) {
		const content = normalize(turn.el);
		if (!content) {
			// Streaming placeholders and empty turns carry nothing worth saving.
			skippedUnparseable++;
			continue;
		}
		messages.push({
			id: `${conversationIdValue}-m${index}`,
			role: turn.role,
			content,
			timestamp: now,
		});
		index++;
	}

	const conversation: CurtConversation = {
		id: conversationIdValue,
		title: conversationTitle(title),
		createdAt: now,
		updatedAt: now,
		messages,
		provider: PROVIDER,
	};

	return {
		conversation,
		skippedUnparseable,
		skippedDuplicates: duplicates.count,
		sourceUrl: loc.href,
	};
}

// --- content-script message listener -----------------------------------------
// Guarded so tests can import this file in a plain jsdom environment.
// chrome.runtime.onMessage behaves identically (callback style) in Firefox
// and Chrome content scripts — no polyfill needed (see docs/store-submissions.md).

interface ExtractRequest {
	type?: unknown;
}

const isExtractRequest = (msg: unknown): msg is ExtractRequest =>
	typeof msg === "object" && msg !== null && (msg as ExtractRequest).type === "curt:extract";

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
	chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
		if (!isExtractRequest(msg)) return; // not ours; let other listeners answer
		const result = extractConversation(document);
		sendResponse(result);
		// Synchronous response; no `return true` needed.
	});
}
