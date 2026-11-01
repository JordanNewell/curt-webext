# Store submissions — curt-webext

One codebase, two stores. Both build from the same `src/` tree; only the
manifest differs (`platform/chrome/manifest.json`,
`platform/firefox/manifest.json`). Listing copy below is a draft — update
before submitting.

## Build commands

```
npm install
npm run build                      # tsc + Chrome staging (dist/)
node platform/firefox/build.mjs    # Firefox staging (dist/firefox/) + zip
# artifact: dist/artifacts/curt_conversation_exporter-<version>.zip
```

Add `web-ext` as a devDependency for the nicer zip path (the build falls
back to PowerShell `Compress-Archive` on Windows when it is absent — both
produce AMO-acceptable zips).

---

## Part 1 — Firefox Add-ons (AMO)

### Manifest version choice (decision + rationale)

**MV3 is the shipped format.** Current policy (verified 2026-11-01):

- AMO accepts **both MV2 and MV3**. Mozilla has publicly committed to
  continuing MV2 support alongside MV3 — there is no AMO deadline forcing a
  migration ([Mozilla's position](https://cyberinsider.com/firefox-says-it-will-continue-to-support-manifest-v2-extensions),
  [migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide)).
- **Google requires MV3** and removed MV2 from the Chrome Web Store on its
  [deprecation timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline).

So: MV3 on Firefox keeps one codebase in lockstep with the Chrome build and
needs no second maintenance track. Firefox MV3 differences from Chrome are
handled entirely in the manifest:

- `browser_specific_settings.gecko` — store id, `strict_min_version: 115.0`,
  and `data_collection_permissions` (AMO's data-consent disclosure; Curt
  collects nothing, so `"required": ["none"]`).
- **No background script at all.** Chrome's `background.service_worker` and
  Firefox's event-page `background.scripts` are mutually incompatible, and
  Curt does not need one: the popup does serialization + `downloads`
  directly, and `chrome.*` promise support exists on both engines
  (Firefox added it in 101). Fewer moving parts = smaller AMO review
  surface. If a background is ever needed on Firefox, use
  `"background": { "scripts": ["...js"] }` — never share the key shape
  with Chrome.
- **No webextension-polyfill.** Evaluated and declined: the only extension
  APIs used are `chrome.tabs.query/sendMessage`, `chrome.downloads.download`,
  and `chrome.runtime.getManifest` — all promise-based on both engines at
  the 115 floor, and the content-script listener uses callback-style
  `chrome.runtime.onMessage`, which is identical in both. The polyfill
  would add a dependency without changing a line of behavior. Revisit if
  any callback-shaped API enters the codebase.

### Pre-submission checklist

- [ ] `node platform/firefox/build.mjs` succeeds (after `npm run build`)
- [ ] `npx web-ext lint --source-dir dist/firefox` — 0 errors. Two known
      benign warnings about `data_collection_permissions` being introduced
      in Firefox 142 while `strict_min_version` is 115 (older releases
      ignore the key; bumping the floor to 142 would cut the audience).
- [ ] Manual smoke test: `about:debugging` → This Firefox → Load Temporary
      Add-on → `dist/firefox/manifest.json`, open a claude.ai conversation,
      Export. Verify the .curt round-trips through `parseCurt`.
- [ ] All permissions justified in the listing (see copy draft)
- [ ] Version in both manifests bumped in lockstep for every resubmission

### AMO source-zip requirement (important)

AMO requires the **source code** for any add-on that uses a build step, so
reviewers can verify the shipped code matches the source
([policy](https://extensionworkshop.com/documentation/publish/add-on-policies/#source-code)):

1. Create `dist/source-firefox/` containing the full repo (minus
   `node_modules`, `dist`, `.git`).
2. Add a top-level `README-BUILD.md` inside it with the exact commands:

   ```
   npm install
   npm run build
   node platform/firefox/build.mjs
   # output: dist/artifacts/curt_conversation_exporter-<version>.zip
   ```

3. The upload flow takes **two zips**: the built add-on zip as the main
   artifact, the source zip attached in the "Source" field of the version
   upload form.

Keep both zips reproducible: same repo commit, tagged release.

### Listing copy draft

**Name:** Curt Conversation Exporter

**Summary (≤250 chars):**
Export your AI chat conversations to .curt — an open, single-file
conversation format. Runs entirely in your browser: no network calls, no
telemetry, your data never leaves the page.

**Description:**

Curt exports live AI chat conversations to the open .curt format
(JSON-based, spec at github.com/JordanNewell/dot_curt). One file, one
conversation, full fidelity — readable by Curtis AI Chat and any .curt
reader.

How it works:

1. Open a supported conversation (claude.ai)
2. Click the Curt toolbar icon
3. Save the .curt file

Permissions, explained:

- `activeTab` + claude.ai host access: read the conversation DOM on the
  tab you're viewing when you click Export. Nothing runs on other sites.
- `downloads`: hand the generated file to Firefox's save dialog.

Data collection: none. Curt makes zero network requests, collects
nothing, and never phones home. The conversation you export goes straight
to a file you save.

**Categories:** Productivity, Social & Communication

**Tags:** claude, export, conversation, curt, backup, ai

### Screenshots needed (1292×856 or 632×406, PNG/JPG ≤4MB)

- [ ] Export flow: claude.ai conversation open + popup with "Export .curt"
- [ ] The Firefox save dialog with a `.curt` filename
- [ ] A .curt file opened in Curtis AI Chat (shows the round trip)

### Review-time expectations

- Average AMO review: **within ~10 business days** for new add-ons
  (auto-signed add-ons that pass automated checks can be near-instant);
  manual review happens when source review triggers or the automated
  scanner flags something. Updates to a listed add-on are usually faster
  than the first submission.
- If source review triggers, expect a few days' delay — keep the source
  zip accurate or the review stalls with an info request.

### Submission steps

1. Sign in to [addons.mozilla.org](https://addons.mozilla.org) → Developer Hub
2. "Submit a New Add-On" → upload `dist/artifacts/curt_conversation_exporter-<version>.zip`
3. Attach the source zip when prompted (build-step flag)
4. Fill the listing (copy draft above), upload screenshots
5. Choose "Listed" distribution; no payments, no AMO ads
6. Submit → note the review URL for tracking

---

## Part 2 — Chrome Web Store

### Pre-submission checklist

- [ ] `npm run build` produces dist/ (Chrome manifest + service worker)
- [ ] Version matches the Firefox release being mirrored
- [ ] Icon set present (16/32/48/128)
- [ ] Privacy practices tab filled: single purpose description, no remote
      code disclosure, limited host access justification

### Listing copy draft

**Name:** Curt Conversation Exporter

**Short description (132 chars):**
Export AI chat conversations to the open .curt format. Local-only: no
network calls, no telemetry.

**Category:** Productivity

**Permission justifications** (paste into the privacy tab):

- `activeTab` / host `https://chatgpt.com/*` (+ `https://claude.ai/*` when
  the Firefox content script is registered for Chrome too) — read
  conversation content on the tab the user is viewing when they click
  Export. No other hosts, no background site access.
- `downloads` — save the generated .curt file via the browser's download
  flow.

**Data disclosure:** Curt does not collect, transmit, or store any user
data. All processing happens in the content script and popup page of the
extension itself.

### Screenshots needed (1280×800 or 640×400, PNG/JPG ≤1MB each)

- [ ] Export flow on chatgpt.com (popup open)
- [ ] Save dialog with `.curt` filename
- [ ] Small tile / icon-only screenshot for the search results card

### Review-time expectations

- First submission: **typically a few hours to a few days**; extensions
  with content scripts get manual review more often. Budget up to a week
  before the listing is live.
- Updates to a published extension are usually faster, but plan for the
  same window during high-volume periods.

### Submission steps

1. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   ($5 one-time registration fee — already paid)
2. "New item" → upload the Chrome build zip (zip the dist/ staging: manifest
   at the zip root — **not** a dist/ parent folder)
3. Store listing tab: description, category, screenshots, icon
4. Privacy tab: single purpose, permission justifications, data-use
   disclosures (all "No" — Curt collects nothing)
5. Distribution tab: public, all regions, no paid features
6. Submit for review → note the item ID for tracking

---

## Shared release notes template

```
curt-webext vX.Y.Z
- Firefox (AMO): curt_conversation_exporter-<version>.zip + source zip
- Chrome (CWS): <chrome build>.zip
Both built from commit <sha>. Same adapter code (src/adapters/**);
manifests differ per store (platform/firefox, platform/chrome).
```

## Known gaps before first submission

- [ ] Icons: neither manifest declares an icon set yet (AMO/CWS will use a
      generated default; add 16/32/48/128 PNGs before submitting)
- [ ] Firefox build should register the chatgpt content script too once its
      selectors are verified on Firefox (add to `content_scripts` + host
      permissions)
- [ ] `src/adapters/registry.ts` needs a claude entry
      (`{ id: "claude", label: "Claude", hostPatterns: ["claude.ai"] }`) so
      the popup shows per-site adapter status on claude.ai
- [ ] Live-claude.ai selector verification (see the adapter header comment)
