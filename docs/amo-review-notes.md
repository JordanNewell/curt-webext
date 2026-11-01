# Notes for AMO reviewers — Curt Conversation Exporter

Thanks for reviewing this add-on. It is a single-purpose export tool: it
reads the conversation DOM on the chat page the user is viewing and saves
it as a `.curt` file. There is no network activity of any kind — no
analytics, no telemetry, no remote code.

## Manifest version and `strict_min_version`

The add-on ships as MV3 with `strict_min_version: 115.0`, while the
`data_collection_permissions` key inside `browser_specific_settings.gecko`
was introduced in Firefox 142. This combination is deliberate:

- MV2/MV3: Mozilla accepts both, but the Chrome build of the same codebase
  is required to be MV3. Shipping MV3 on Firefox keeps one codebase and one
  manifest-diff surface in lockstep across both stores.
- The `data_collection_permissions` disclosure is declared with
  `"required": ["none"]` because the add-on collects nothing. On releases
  older than 142 the unknown key is simply ignored — it is inert metadata,
  not a permission or a code path — so the add-on behaves identically on
  Firefox 115 through 141. `web-ext lint` flags this as a warning; it is
  expected and benign. Lowering `strict_min_version` to 142 to silence it
  would needlessly cut off users on supported ESR releases.

## No background script

There is no background page or service worker, on any platform. The popup
page performs the serialization and calls `browser.downloads.download` /
`chrome.downloads.download` directly. Nothing needs to run when the popup
is closed, so there is no event page. The APIs involved are promise-based,
and Firefox has supported `chrome.*` promises since Firefox 101 — well
under the 115 floor.

## No `webextension-polyfill`

Deliberately absent. The extension uses five APIs total:
`chrome.tabs.query`, `chrome.tabs.sendMessage`, `chrome.downloads.download`,
`chrome.runtime.getManifest`, and the `chrome.runtime.onMessage` listener in
the content scripts. At the 115 floor, the first four resolve promises
identically on Firefox and Chromium, and `onMessage` is used in plain
callback style, which is also identical across engines. The polyfill would
add a bundled dependency without changing a single line of behavior; we
preferred the smaller, dependency-free bundle for reviewability. If a
callback-shaped API ever enters the codebase, we will revisit.

## Source code submission

The uploaded zip is produced by a build step (TypeScript compilation), so
the source zip is attached per the source-code policy. The build is
reproducible from the repository at
https://github.com/JordanNewell/curt-webext :

```
npm install
npm run build
node platform/firefox/build.mjs
# output: dist/artifacts/curt_conversation_exporter-<version>.zip
```

The `platform/firefox/build.mjs` step stages the Firefox manifest and
produces the zip. A `README-BUILD.md` with these commands is included at
the root of the source zip.

## Permissions justification

- `activeTab` — read the conversation DOM on the tab the user is viewing,
  at the moment they click Export. Nothing runs on any other tab.
- `downloads` — hand the generated `.curt` file to Firefox's save dialog.
- Host permissions / content scripts: `https://claude.ai/*` and
  `https://chatgpt.com/*` only — the two chat sites the exporter supports.
  No other hosts, no `<all_urls>`, no optional permissions.

Contact: Jordan Newell — jordan@jordannewell.com · https://dotcurt.org
