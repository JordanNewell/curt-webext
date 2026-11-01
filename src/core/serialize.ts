/**
 * .curt v1 serializer (writer side of dot_curt SPEC.md).
 *
 * Zero runtime deps: this file is loaded by the MV3 popup (an ES module
 * context). Output matches the reference `serializeCurt` in curt-format
 * byte-for-byte: tab-indented JSON, no trailing newline, no BOM. JSON
 * escaping means the only raw newlines in the body are the LF separators
 * JSON.stringify emits — never CR.
 */

import type { CurtConversation, CurtMessage, CurtRole } from "./types.js";

export const CURT_MAGIC = "curtis-conversation";
export const CURT_VERSION = 1;
/** generator field prefix; callers append "@<version>" from their manifest. */
export const CURT_GENERATOR_PREFIX = "curt-webext";

export interface CurtFile {
	curt: typeof CURT_MAGIC;
	version: typeof CURT_VERSION;
	generator?: string;
	extensions?: string[];
	conversation: CurtConversation;
}

/**
 * Serialize a conversation as a complete .curt file body. Throws when the
 * conversation cannot satisfy v1 validation (missing required fields, wrong
 * types, unknown role) — a writer must never emit a file it cannot parse.
 */
export function serializeCurt(
	conversation: CurtConversation,
	generator?: string,
	extensions?: string[],
): string {
	assertWritable(conversation);
	const file: CurtFile = {
		curt: CURT_MAGIC,
		version: CURT_VERSION,
		conversation,
	};
	if (generator) file.generator = generator;
	if (extensions?.length) file.extensions = [...extensions];
	// JSON.stringify inserts LF between indented lines; content newlines are
	// escaped as \n inside strings, so the body contains LF endings only.
	return JSON.stringify(file, null, "\t");
}

const ROLES: readonly CurtRole[] = ["user", "assistant", "system", "tool"];

export function isWritableConversation(v: unknown): v is CurtConversation {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const c = v as CurtConversation;
	return (
		typeof c.id === "string" &&
		typeof c.title === "string" &&
		typeof c.createdAt === "number" &&
		typeof c.updatedAt === "number" &&
		Array.isArray(c.messages) &&
		c.messages.every(isWritableMessage)
	);
}

export function isWritableMessage(v: unknown): v is CurtMessage {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const m = v as CurtMessage;
	return (
		typeof m.id === "string" &&
		ROLES.includes(m.role) &&
		typeof m.content === "string" &&
		typeof m.timestamp === "number"
	);
}

function assertWritable(conversation: CurtConversation): void {
	if (!isWritableConversation(conversation)) {
		throw new TypeError(
			"refusing to serialize: conversation does not satisfy .curt v1",
		);
	}
}
