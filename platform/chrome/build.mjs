// Build wiring for the Chrome (MV3) target. Run after `tsc`:
//   npm run build
// `tsc` emits dist/src/** and dist/platform/chrome/service-worker.js; this
// script copies the static assets that make dist/ a loadable extension root.
import { execFileSync } from "node:child_process";
import { build as esbuildBuild } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

// --- Store package (CWS submission) ------------------------------------------
// The CWS pipeline rejects packages containing more than one manifest.json,
// and dist/ legitimately holds two (chrome + firefox). Stage ONLY the files
// the Chrome manifest tree loads into dist/chrome/ — mirroring the Firefox
// target — and zip that. manifest.json sits at the zip root.
const stage = join(dist, "chrome");
const artifacts = join(dist, "artifacts");

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "src"), { recursive: true });
mkdirSync(join(stage, "platform", "chrome"), { recursive: true });
mkdirSync(join(stage, "platform", "icons"), { recursive: true });
mkdirSync(artifacts, { recursive: true });

cpSync(join(dist, "manifest.json"), join(stage, "manifest.json"));
for (const rel of ["src/ui", "src/core", "src/adapters/registry.js", "src/adapters/chatgpt", "src/adapters/claude"]) {
	cpSync(join(dist, rel), join(stage, rel), { recursive: true });
}
cpSync(join(dist, "platform", "chrome", "service-worker.js"), join(stage, "platform", "chrome", "service-worker.js"));
cpSync(join(dist, "platform", "icons"), join(stage, "platform", "icons"), { recursive: true });

const { version } = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
const artifact = join(artifacts, `curt_conversation_exporter-${version}-chrome.zip`);

function zipWithPowerShell() {
	// Compress-Archive zips CONTENTS with -Path '...\*' so manifest.json
	// lands at the archive root (zipping the folder itself would nest it).
	execFileSync("powershell.exe", [
		"-NoProfile", "-Command",
		`Compress-Archive -Path (Join-Path '${stage.replaceAll("'", "''")}' '*') -DestinationPath '${artifact.replaceAll("'", "''")}' -Force`,
	]);
}

zipWithPowerShell();

const manifestCount = countManifests(artifact);
if (manifestCount !== 1) {
	console.error(`CWS package invalid: ${manifestCount} manifest.json entries (need exactly 1).`);
	process.exit(1);
}

console.log(`Artifact: ${artifact}`);
console.log("CWS upload: developer dashboard -> New item -> this zip; AMO gets the -firefox zip.");

// Parse the zip central directory (filenames are stored uncompressed there)
// and count manifest.json entries.
function countManifests(zipPath) {
	const buf = new Uint8Array(readFileSync(zipPath));
	const SIG = [0x50, 0x4b, 0x01, 0x02]; // PK\x01\x02 central-directory header
	let count = 0;
	for (let i = 0; i + 46 <= buf.length; i++) {
		if (buf[i] !== SIG[0] || buf[i + 1] !== SIG[1] || buf[i + 2] !== SIG[2] || buf[i + 3] !== SIG[3]) continue;
		const nameLen = buf[i + 28] | (buf[i + 29] << 8);
		const extraLen = buf[i + 30] | (buf[i + 31] << 8);
		const commentLen = buf[i + 32] | (buf[i + 33] << 8);
		const name = new TextDecoder().decode(buf.slice(i + 46, i + 46 + nameLen));
		if (name === "manifest.json" || name.endsWith("/manifest.json")) count++;
		i += 46 + nameLen + extraLen + commentLen - 1;
	}
	return count;
}
