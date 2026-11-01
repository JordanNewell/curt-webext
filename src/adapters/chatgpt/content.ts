/**
 * ChatGPT adapter: DOM walker for chatgpt.com conversation threads.
 *
 * MV3 CONTENT-SCRIPT CONSTRAINT: Chrome content scripts cannot resolve
 * extension-relative module imports, so this file is deliberately
 * self-contained — the walker lives here alongside the message listener.
 * The only import is type-only and erased at compile time.
 *
 * Selector strategy: prefer ChatGPT's stable data attributes
 * (`[data-message-author-role]`, `data-message-id`); never rely on the
 * generated class-name soup. Degrade gracefully: unparseable nodes are
 * counted (ExtractResult.skippedUnparseable) and the export continues —
 * the walker never aborts mid-conversation.
 */

import type { CurtConversation, CurtMessage, CurtRole, ExtractResult } from "../../core/types.js";

// 2026-11 DOM: message nodes are `[data-conversation-role]` inside a turn
// container carrying `data-turn-key` (uuid). Legacy era used
// `[data-message-author-role]` + `data-message-id` — still matched so the
// adapter survives on either rendering.
const ROLE_SELECTOR = "[data-conversation-role],[data-message-author-role]";
const TURN_ATTR = "data-turn-key";
const KNOWN_ROLES: readonly CurtRole[] = ["user", "assistant", "system", "tool"];
const PROVIDER = "openai";
/** Assistant messages carry a model tag here when the page exposes one. */
const MODEL_ATTR = "data-message-model";
/** Elements stripped before text extraction (labels, actions, chrome). */
const STRIP_SELECTOR =
	"script,style,noscript,template,svg,button,canvas,[class*='sr-only'],[data-testid*='scroll-footer']";
/** Site disclaimer appended under turns — never part of the conversation. */
const DISCLAIMER_RE = /\s*ChatGPT can make mistakes\.?\s*Check important info\.?\s*$/i;
/** Candidate selectors probed on a zero-message result — live-DOM triage. */
const PROBE_SELECTORS: readonly string[] = [
	"[data-conversation-role]",
	"[data-turn-key]",
	"[data-message-author-role]",
	"[data-message-id]",
	"[data-testid^='conversation-turn']",
	"article",
	"[data-markdown-copy]",
	"[class*='message']",
];

interface ExtractOptions {
	/** Overrides Date.now() (tests). */
	now?: number;
	/** Overrides location (tests). */
	location?: { href: string; pathname: string };
	/** Overrides document.title (tests). */
	title?: string;
}

/**
 * Documents to search, top frame first, then same-origin iframes (the app
 * shell sometimes hosts the conversation in a child frame — the top-frame
 * content script sees only the shell there). Cross-origin iframes yield
 * `doc: null` but keep their src for the probe.
 */
interface FrameDoc {
	doc: Document | null;
	src: string;
}

function candidateDocs(doc: Document): FrameDoc[] {
	const frames: FrameDoc[] = [{ doc, src: doc.defaultView?.location.href ?? "" }];
	for (const frame of doc.querySelectorAll("iframe")) {
		const src = frame.getAttribute("src") ?? "";
		let inner: Document | null = null;
		try {
			inner = (frame as HTMLIFrameElement).contentDocument;
		} catch {
			// cross-origin: contentDocument throws or is null depending on browser
		}
		frames.push({ doc: inner, src });
	}
	return frames;
}

/** Extract the conversation currently rendered in `doc`. Never throws. */
export function extractConversation(doc: Document, options: ExtractOptions = {}): ExtractResult {
	const now = options.now ?? Date.now();
	const loc = options.location ?? doc.defaultView?.location ?? { href: "", pathname: "/" };
	const title = options.title ?? doc.title;

	const frames = candidateDocs(doc);
	// Walk the frame holding the most role nodes (top frame wins ties).
	let source = doc;
	let bestCount = doc.querySelectorAll(ROLE_SELECTOR).length;
	frames.forEach((f, i) => {
		if (i === 0 || !f.doc) return;
		const n = f.doc.querySelectorAll(ROLE_SELECTOR).length;
		if (n > bestCount) {
			bestCount = n;
			source = f.doc;
		}
	});

	let skippedUnparseable = 0;
	let skippedDuplicates = 0;
	const messages: CurtMessage[] = [];
	const seenIds = new Set<string>();

	// 2026-11 DOM: `[data-conversation-role]` nodes are print-style LABEL
	// headers ("You said:" / "ChatGPT said:") inside a `[data-turn-key]`
	// container — the message bubbles are their FOLLOWING SIBLINGS. So per
	// turn container: role markers switch the attribution target, and every
	// non-marker block between markers belongs to that role.
	const turns = source.querySelectorAll(`[${TURN_ATTR}]`);
	if (turns.length > 0) {
		for (const turnEl of turns) {
			const turnKey = turnEl.getAttribute(TURN_ATTR) ?? `turn-${messages.length}`;
			if (seenIds.has(turnKey)) {
				skippedDuplicates++;
				continue;
			}
			seenIds.add(turnKey);

			const segments = walkTurn(turnEl);
			let segInTurn = 0;
			for (const seg of segments) {
				const content = seg.parts
					.join("")
					.replace(/[ \t]+\n/g, "\n")
					.trim()
					.replace(DISCLAIMER_RE, "")
					.trim();
				if (!content) {
					skippedUnparseable++;
					continue;
				}
				messages.push({
					id: `${turnKey}-${segInTurn++}`,
					role: seg.role,
					content,
					timestamp: now,
				});
			}
		}
	} else {
		// Legacy DOM: role elements ARE the message bodies.
		for (const node of source.querySelectorAll(ROLE_SELECTOR)) {
			const rawRole = node.getAttribute("data-message-author-role") ?? "";
			const role = KNOWN_ROLES.find((r) => r === rawRole);
			if (!role) {
				skippedUnparseable++;
				continue;
			}
			const domId = node.getAttribute("data-message-id");
			if (domId && seenIds.has(domId)) {
				skippedDuplicates++;
				continue;
			}
			const content = normalize(node);
			if (!content) {
				skippedUnparseable++;
				continue;
			}
			const message: CurtMessage = {
				id: domId ?? `chatgpt-msg-${messages.length}`,
				role,
				content,
				timestamp: now,
			};
			const model = node.getAttribute(MODEL_ATTR);
			if (model) message.model = model;
			if (domId) seenIds.add(domId);
			messages.push(message);
		}
	}

	const conversation: CurtConversation = {
		id: conversationId(loc.pathname, now),
		title: conversationTitle(title),
		createdAt: now,
		updatedAt: now,
		messages,
		provider: PROVIDER,
	};

	const probe: Record<string, number | string> = {};
	if (messages.length === 0) {
		for (const sel of PROBE_SELECTORS) {
			probe[sel] = source.querySelectorAll(sel).length;
		}
		frames.forEach((f, i) => {
			const tag = `__frame${i}`;
			if (!f.doc) {
				probe[tag] = `X-ORIGIN ${f.src.slice(0, 60)}`;
			} else if (i === 0) {
				probe[tag] = f.doc.querySelectorAll("*").length;
			} else {
				probe[tag] = `${f.doc.querySelectorAll("*").length}el ${f.src.slice(0, 60)}`;
			}
		});
	}

	return {
		conversation,
		skippedUnparseable,
		skippedDuplicates,
		sourceUrl: loc.href,
		...(messages.length === 0 ? { probe } : {}),
	};
}

/**
 * Walk one `[data-turn-key]` container. `data-conversation-role` markers
 * are label headers that SWITCH the attribution target — the message text
 * is the non-marker content that follows each marker until the next one.
 * Block-aware, verbatim pre/code, strips actions/labels/chrome.
 */
interface Segment {
	role: CurtRole;
	parts: string[];
}

function walkTurn(turnEl: Element): Segment[] {
	const segments: Segment[] = [];
	let current: Segment | null = null;
	const push = (s: string): void => {
		if (current) current.parts.push(s);
	};
	const boundary = (): void => {
		if (!current) return;
		const last = current.parts[current.parts.length - 1];
		if (last === undefined || !last.endsWith("\n")) current.parts.push("\n");
	};

	const walk = (node: Node): void => {
		if (isElement(node)) {
			const convRole = node.getAttribute("data-conversation-role");
			if (convRole !== null) {
				const role = KNOWN_ROLES.find((r) => r === convRole);
				if (role) {
					current = { role, parts: [] };
					segments.push(current);
				}
				return; // label header — never descend
			}
			if (node.matches(STRIP_SELECTOR)) return;
			if (node.tagName === "PRE") {
				push(node.textContent ?? "");
				boundary();
				return;
			}
			if (node.tagName === "BR") {
				push("\n");
				return;
			}
			for (const child of Array.from(node.childNodes)) walk(child);
			if (BLOCK_TAGS.has(node.tagName)) boundary();
			return;
		}
		if (node.nodeType === 3 && current) push(node.nodeValue ?? ""); // TEXT_NODE
	};

	walk(turnEl);
	return segments;
}

/**
 * Block-aware plain text on a detached clone: strips action buttons,
 * screen-reader labels ("You said:") and chrome, keeps pre/code verbatim,
 * inserts one newline per block boundary. Deliberately avoids `innerText`
 * (CSS-layout dependent, untestable in jsdom). Legacy-DOM path.
 */
function normalize(node: Element): string {
	const clone = node.cloneNode(true) as Element;
	for (const junk of clone.querySelectorAll(STRIP_SELECTOR)) junk.remove();
	const parts: string[] = [];
	collect(clone, parts);
	return parts
		.join("")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

/** Block-level elements get one newline separator; nested blocks don't stack. */
const BLOCK_TAGS = new Set([
	"ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIALOG",
	"DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
	"H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "LI", "MAIN",
	"NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL",
]);

function isElement(node: Node): node is Element {
	return node.nodeType === 1; // Node.ELEMENT_NODE
}

function boundary(out: string[]): void {
	const last = out[out.length - 1];
	if (last !== undefined && last.endsWith("\n")) return;
	out.push("\n");
}

function collect(node: Node, out: string[]): void {
	if (isElement(node)) {
		if (node.tagName === "PRE") {
			out.push(node.textContent ?? "");
			boundary(out);
			return;
		}
		if (node.tagName === "BR") {
			out.push("\n");
			return;
		}
		for (const child of Array.from(node.childNodes)) collect(child, out);
		if (BLOCK_TAGS.has(node.tagName)) boundary(out);
		return;
	}
	if (node.nodeType === 3) out.push(node.nodeValue ?? ""); // TEXT_NODE
}

/** "abc123-..." from /c/<uuid> -> "chatgpt_abc123-..."; else time-derived. */
function conversationId(pathname: string, now: number): string {
	const match = /\/c\/([0-9a-f-]{8,})/i.exec(pathname);
	if (match) return `chatgpt_${match[1]}`;
	return `chatgpt_${now.toString(36)}`;
}

/** Strip the "| ChatGPT" site suffix; untitled threads -> "". */
function conversationTitle(title: string): string {
	const cleaned = title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
	return cleaned === "ChatGPT" ? "" : cleaned;
}

// --- MV3 content-script message listener ------------------------------------
// Guarded so tests can import this file in a plain jsdom environment.

interface ExtractRequest {
	type?: unknown;
}

const isExtractRequest = (msg: unknown): msg is ExtractRequest =>
	typeof msg === "object" && msg !== null && (msg as ExtractRequest).type === "curt:extract";

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
	chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
		if (isDebugDomRequest(msg)) {
			// Debug triage: hand back the serialized page for selector work.
			const html = document.documentElement.outerHTML;
			sendResponse({ type: "curt:debugdom", url: location.href, html });
			return;
		}
		if (!isExtractRequest(msg)) return; // not ours; let other listeners answer
		const result = extractConversation(document);
		sendResponse(result);
		// Synchronous response; no `return true` needed.
	});
}

function isDebugDomRequest(msg: unknown): boolean {
	return (
		typeof msg === "object" && msg !== null && (msg as ExtractRequest).type === "curt:debugdom"
	);
}
