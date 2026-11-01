/**
 * Output file naming per dot_curt SPEC.md "Bulk convention":
 * `"<YYYY-MM-DD> <slug> <suffix>.curt"` — derived only from immutable
 * fields (`createdAt`, `id`) so the name survives title edits and updates.
 */

import type { CurtConversation } from "./types.js";

export function curtFilename(conversation: CurtConversation): string {
	const date = utcDatePart(conversation.createdAt);
	const slug = slugify(conversation.title);
	const id = conversation.id;
	const suffix = (id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : "") || id.slice(-8);
	return `${date} ${slug} ${suffix}.curt`;
}

function utcDatePart(createdAt: number): string {
	if (!Number.isFinite(createdAt)) return "1970-01-01";
	try {
		return new Date(createdAt).toISOString().slice(0, 10);
	} catch {
		return "1970-01-01";
	}
}

/** Lowercase, runs of letters/digits joined with "-", 50 chars max. */
function slugify(title: string): string {
	const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	const joined = words.join("-");
	const capped = Array.from(joined).slice(0, 50).join("");
	return capped.replace(/-+$/, "") || "untitled";
}
