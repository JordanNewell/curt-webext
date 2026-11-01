// Build wiring for the Chrome (MV3) target. Run after `tsc`:
//   npm run build
// `tsc` emits dist/src/** and dist/platform/chrome/service-worker.js; this
// script copies the static assets that make dist/ a loadable extension root.
import { build as esbuildBuild } from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "dist");

if (!existsSync(join(dist, "src", "ui", "popup.js"))) {
	console.error("dist/src/ui/popup.js missing — run `tsc` first (npm run build).");
	process.exit(1);
}

// Content scripts load as CLASSIC scripts — top-level `export` is a
// SyntaxError there (the whole file dies, listener never registers).
// tsc emits ESM; transform each content script to an IIFE in place.
// MV3 content scripts cannot resolve imports either — esbuild bundles
// if a walker ever grows real imports.
for (const rel of ["src/adapters/chatgpt/content.js", "src/adapters/claude/content.js"]) {
	await esbuildBuild({
		entryPoints: [join(dist, rel)],
		allowOverwrite: true,
		bundle: true,
		format: "iife",
		outfile: join(dist, rel),
		logLevel: "warning",
	});
}

mkdirSync(join(dist, "platform", "chrome"), { recursive: true });
mkdirSync(join(dist, "platform", "icons"), { recursive: true });
mkdirSync(join(dist, "src", "ui"), { recursive: true });

cpSync(join(root, "platform", "chrome", "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "src", "ui", "popup.html"), join(dist, "src", "ui", "popup.html"));
cpSync(join(root, "src", "ui", "popup.css"), join(dist, "src", "ui", "popup.css"));
cpSync(join(root, "platform", "icons"), join(dist, "platform", "icons"), { recursive: true });

console.log("dist/ ready — load as an unpacked extension in Chrome.");
