// Build-artifact contract: what ships must parse and load like a real
// extension. These run against dist/ AFTER `npm run build && node
// platform/firefox/build.mjs` — skipped when dist is absent (bare `vitest run`
// on a fresh clone) so unit tests never depend on a build having happened.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");
const built = existsSync(join(dist, "manifest.json"));

describe.skipIf(!built)("build artifacts (dist/)", () => {
	// Content scripts load as CLASSIC scripts — an ESM export surviving the
	// bundle is a SyntaxError that silently kills injection (see git history).
	const contentScripts = [
		"src/adapters/chatgpt/content.js",
		"src/adapters/claude/content.js",
	];

	for (const rel of contentScripts) {
		it(`${rel} parses as a classic script (no ESM syntax)`, () => {
			expect(() =>
				execFileSync(process.execPath, ["--check", join(dist, rel)], { stdio: "pipe" }),
			).not.toThrow();
		});
	}

	for (const platform of ["chrome", "firefox"]) {
		it(`${platform} manifest is valid JSON with minimal permissions`, () => {
			const manifest = JSON.parse(
				readFileSync(join(dist, platform === "chrome" ? "manifest.json" : "firefox/manifest.json"), "utf8"),
			);
			expect(manifest.manifest_version).toBe(3);
			expect(manifest.permissions).toEqual(["activeTab", "downloads"]);
			expect(manifest.content_scripts?.length).toBeGreaterThan(0);
		});

		it(`${platform} manifest references only files that exist`, () => {
			const base = platform === "chrome" ? dist : join(dist, "firefox");
			const manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
			const referenced: string[] = [manifest.action?.default_popup ?? "", manifest.background?.service_worker ?? ""];
			for (const cs of manifest.content_scripts ?? []) referenced.push(...(cs.js ?? []));
			if (manifest.action?.default_icon)
				referenced.push(...Object.values<string>(manifest.action.default_icon));
			if (manifest.icons) referenced.push(...Object.values<string>(manifest.icons));
			for (const rel of referenced.filter(Boolean)) {
				expect(existsSync(join(base, rel)), rel).toBe(true);
			}
		});
	}

	it("chrome and firefox manifests register the same content scripts", () => {
		const chrome = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
		const firefox = JSON.parse(readFileSync(join(dist, "firefox/manifest.json"), "utf8"));
		const flatten = (m: { content_scripts?: { js?: string[] }[] }) =>
			(m.content_scripts ?? []).flatMap((cs) => cs.js ?? []).sort();
		expect(flatten(chrome)).toEqual(flatten(firefox));
	});

	it("firefox artifact zip exists and is non-trivial", () => {
		const artifacts = join(dist, "artifacts");
		const zips = existsSync(artifacts)
			? readdirSync(artifacts).filter((f) => f.endsWith(".zip"))
			: [];
		expect(zips.length).toBeGreaterThan(0);
		const zip = join(artifacts, zips[0]);
		expect(statSync(zip).size).toBeGreaterThan(10_000);
	});

	it("versions are in lockstep across package.json and both manifests", () => {
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const chrome = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
		const firefox = JSON.parse(readFileSync(join(dist, "firefox/manifest.json"), "utf8"));
		expect(chrome.version).toBe(pkg.version);
		expect(firefox.version).toBe(pkg.version);
	});
});
