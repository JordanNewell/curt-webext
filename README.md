# curt-webext

Cross-browser extension that exports live AI chat conversations to the
open [.curt format](https://github.com/JordanNewell/dot_curt) (SPEC.md v1).

Zero runtime dependencies. `curt-format` is a dev dependency only, used by
the test suite to prove emitted files round-trip through the reference
`parseCurt`.

## Supported sites

| Site | Adapter | Notes |
|---|---|---|
| chatgpt.com | `src/adapters/chatgpt` | Stable `data-message-author-role` / `data-message-id` attributes |

Firefox (`platform/firefox`) and the Claude adapter (`src/adapters/claude`)
are tracked separately.

## Build (Chrome / MV3)

```sh
npm install
npm run build
```

Then load `dist/` as an unpacked extension at `chrome://extensions`
(developer mode on). `npm test` runs the unit suite.

## Layout

- `src/core` — capture model, .curt v1 serializer, DOM helpers, filename convention
- `src/adapters` — per-site extractors (content scripts)
- `src/ui` — popup (status + Export button)
- `platform/chrome` — MV3 manifest, service worker, build wiring

## MV3 constraints worth knowing

- Content scripts cannot resolve extension-relative module imports, so each
  adapter content script is deliberately self-contained; it imports only
  `type`-only symbols from core (erased at compile time).
- Service workers have no `URL.createObjectURL`, so the popup serializes and
  downloads via a blob URL itself; the service worker offers a data-URL
  fallback for DOM-less callers.

## DOM assumptions (verify against live chatgpt.com)

- Messages: `[data-message-author-role="user|assistant"]` in document order.
- Assistant nodes carry `data-message-id`; user nodes historically may not.
- No per-message timestamps are exposed in the DOM — all messages get the
  export time, and `createdAt`/`updatedAt` equal that instant.
- Model id: optional `data-message-model` attribute; absent on current
  builds, so `model` is usually omitted.
- Conversation id: the UUID in `/c/<uuid>`; untitled pages yield `""` title.
