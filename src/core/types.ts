/**
 * Capture model: the subset of .curt v1 (see E:/dev/projects/dot_curt/SPEC.md)
 * that curt-webext writes. Mirrors curt-format's CurtMessage/CurtConversation
 * so a serialized conversation round-trips through parseCurt.
 */

export type CurtRole = "user" | "assistant" | "system" | "tool";

export interface CurtMessage {
	/** Stable message identifier (string). */
	id: string;
	role: CurtRole;
	/** Message text. */
	content: string;
	/** Epoch milliseconds. */
	timestamp: number;
	/** Provider model id, when the page exposes one. */
	model?: string;
	[key: string]: unknown;
}

export interface CurtConversation {
	id: string;
	title: string;
	/** Epoch milliseconds. */
	createdAt: number;
	/** Epoch milliseconds. */
	updatedAt: number;
	messages: CurtMessage[];
	/** Display metadata: which provider the conversation came from. */
	provider?: string;
	model?: string;
	[key: string]: unknown;
}

/** Result of running one adapter against a page's DOM. */
export interface ExtractResult {
	conversation: CurtConversation;
	/** DOM nodes that looked like messages but could not be parsed. */
	skippedUnparseable: number;
	/** Nodes skipped as duplicates (same data-message-id seen earlier). */
	skippedDuplicates: number;
	/** Source page URL the conversation was captured from. */
	sourceUrl: string;
	/** Live-DOM diagnostic: candidate selector → match count (0-message triage). */
	probe?: Record<string, number | string>;
}
