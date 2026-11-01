# Curt Conversation Exporter

Browser extension that exports the AI chat you're looking at — one click — to a
portable, spec-compliant [`.curt`](https://github.com/JordanNewell/dot_curt)
file. No accounts, no cloud, no copy-paste gymnastics: the conversation in the
tab becomes a single UTF-8 `.curt` file on disk, readable by every app that
speaks the format.

## Supported sites and browsers

| Site | Browser | Notes |
|---|---|---|
| chatgpt.com | Chrome / Edge (MV3), Firefox 115+ | |
| claude.ai | Chrome / Edge (MV3), Firefox 115+ | |

One codebase, two manifests: `platform/chrome/` (MV3) and `platform/firefox/`
(MV3, `strict_min_version: 115.0`). Verified working on both sites in both
browsers.

## Privacy

Zero collection, zero network, all local. The extension has no host-side
backend, sends nothing anywhere, and touches only the conversation already in
your tab — extraction and serialization happen entirely in the browser. See the
[privacy policy](https://dotcurt.org/privacy/) for the full statement.

## Install

Store listings (Chrome Web Store, Firefox Add-ons) are in review — links will
land here when they're live. Today, build from source:

```sh
npm install
npm run build                      # tsc + Chrome staging -> dist/
node platform/firefox/build.mjs    # Firefox staging -> dist/firefox/ (+ AMO zip)
```

- **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`), developer
  mode on, "Load unpacked" → `dist/`.
- **Firefox:** `about:debugging#/runtime/this-firefox`, "Load Temporary
  Add-on…" → `dist/firefox/manifest.json`.

## Development

```sh
npm test                # vitest (npx vitest run)
npm run build           # tsc + Chrome staging
node platform/chrome/build.mjs   # Chrome staging alone
node platform/firefox/build.mjs  # Firefox staging + zip
```

- `src/core` — capture model, .curt v1 serializer, DOM helpers, filename convention
- `src/adapters` — per-site extractors (content scripts), dispatched via `registry.ts`
- `src/ui` — popup (status + Export)
- `platform/chrome`, `platform/firefox` — manifests, service worker, build wiring

One build quirk worth knowing: content scripts are bundled to IIFE because
classic scripts can't carry ESM `import`/`export` — the browser injects them as
plain `<script>` code, not modules, so the ESM output from `tsc` is transformed
in place before staging.

## Format compliance

Output is `.curt` v1 per [dotcurt.org](https://dotcurt.org) /
[SPEC.md](https://github.com/JordanNewell/dot_curt/blob/main/SPEC.md). The test
suite round-trips every serialized conversation through `curt-format`'s
reference `parseCurt` (dev dependency only — zero runtime dependencies).

## Part of the .curt suite

- [`curt-format`](https://github.com/JordanNewell/dot_curt) — the .curt format spec + reference implementation ([npm](https://www.npmjs.com/package/curt-format))
- [`curt-convert`](https://github.com/JordanNewell/curt-convert) — Claude Code transcripts → .curt
- [`curt-openwith`](https://github.com/JordanNewell/curt-openwith) — double-click any .curt file: offline viewer

MIT — see `license` in [package.json](package.json).
