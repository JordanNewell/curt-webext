import { describe, expect, it } from "vitest";
import { isCurtConversation, parseCurt } from "curt-format";
import { CURT_MAGIC, CURT_VERSION, serializeCurt } from "../../src/core/serialize.js";
import type { CurtConversation, CurtMessage } from "../../src/core/types.js";

const GENERATOR = "curt-webext@0.1.0";

function conversation(overrides: Partial<CurtConversation> = {}): CurtConversation {
	const messages: CurtMessage[] = [
		{ id: "m1", role: "user", content: "Hello\nworld", timestamp: 1700000000000 },
		{
			id: "m2",
			role: "assistant",
			content: "Hi! こんにちは 🎉",
			timestamp: 1700000005000,
			model: "gpt-4o",
		},
	];
	return {
		id: "chatgpt_abc-123",
		title: "Test conversation",
		createdAt: 1700000000000,
		updatedAt: 1700000005000,
		messages,
		provider: "openai",
		...overrides,
	};
}

describe("serializeCurt", () => {
	it("round-trips through curt-format parseCurt", () => {
		const body = serializeCurt(conversation(), GENERATOR);
		const parsed = parseCurt(body);
		expect(parsed).not.toBeNull();
		expect(parsed).toEqual(conversation());
		// isCurtConversation takes the conversation object (parseCurt applies
		// it to file.conversation); verify the component predicate directly.
		const file = JSON.parse(body) as Record<string, unknown>;
		expect(isCurtConversation(file.conversation)).toBe(true);
	});

	it("round-trips a conversation with unknown/extra fields", () => {
		const c = conversation({
			model: "gpt-4o",
			messages: [
				{ id: "m1", role: "user", content: "q", timestamp: 1, extra: { nested: true } },
				{ id: "m2", role: "assistant", content: "a", timestamp: 2 },
			],
		});
		const parsed = parseCurt(serializeCurt(c, GENERATOR));
		expect(parsed).toEqual(c);
	});

	it("handles empty title, unicode, newlines, and quotes", () => {
		const c = conversation({
			title: "",
			messages: [
				{
					id: "m1",
					role: "user",
					content: 'line1\nline2\t"quoted" \\ backslash — émoji é',
					timestamp: 0,
				},
			],
		});
		const parsed = parseCurt(serializeCurt(c, GENERATOR));
		expect(parsed).toEqual(c);
	});

	it("emits the correct header: magic, numeric version, generator", () => {
		const body = serializeCurt(conversation(), GENERATOR);
		const file = JSON.parse(body) as Record<string, unknown>;
		expect(file.curt).toBe(CURT_MAGIC);
		expect(file.version).toBe(CURT_VERSION);
		expect(file.version).toBeTypeOf("number"); // string "1" is a spec rejection
		expect(file.generator).toBe(GENERATOR);
	});

	it("never emits a BOM and uses LF endings only (no CR bytes)", () => {
		const body = serializeCurt(conversation(), GENERATOR);
		expect(body.charCodeAt(0)).not.toBe(0xfeff);
		expect(body).not.toMatch(/\r/);
		expect(body).toMatch(/\n/); // tab-indented, multi-line
		expect(body).toMatch(/^\{\n\t"/);
	});

	it("omits generator/extensions when not provided", () => {
		const file = JSON.parse(serializeCurt(conversation())) as Record<string, unknown>;
		expect("generator" in file).toBe(false);
		expect("extensions" in file).toBe(false);
	});

	it("throws rather than emitting an invalid conversation", () => {
		expect(() => serializeCurt({ id: 1 } as unknown as CurtConversation)).toThrow();
		expect(() =>
			serializeCurt(
				conversation({
					messages: [{ id: "m1", role: "wizard" as never, content: "x", timestamp: 0 }],
				}),
			),
		).toThrow();
	});
});
