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

const ROLE_SELECTOR = "[data-message-author-role]";
const KNOWN_ROLES: readonly CurtRole[] = ["user", "assistant", "system", "tool"];
const PROVIDER = "openai";
/** Assistant messages carry a model tag here when the page exposes one. */
const MODEL_ATTR = "data-message-model";
/** Candidate selectors probed on a zero-message result — live-DOM triage. */
const PROBE_SELECTORS: readonly string[] = [
	"[data-message-author-role]",
	"[data-message-id]",
	"[data-testid^='conversation-turn']",
	"[data-testid^='message']",
	"article",
	"[class*='markdown']",
	"[class*='message']",
	"[data-starting-point]",
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
			// Streaming placeholders and empty turns carry nothing worth saving.
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

/** innerText when the environment has it, textContent otherwise; trimmed. */
function normalize(node: Element): string {
	const htmlEl = node as HTMLElement;
	const raw =
		typeof htmlEl.innerText === "string" ? htmlEl.innerText : (node.textContent ?? "");
	return raw.replace(/\r\n?/g, "\n").trim();
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
