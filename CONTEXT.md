# Swipe Archiver — Project Context and Handoff

## How to use this document

`CONTEXT.md` is this project's handoff/reference document for future chats that do not have access to the original conversation history. Use it to orient yourself quickly, then inspect the relevant current files before making a change; do not rely blindly on this summary. When significant architecture, files, data contracts, or user-facing features change, update `CONTEXT.md` in the same change so it remains an accurate reference.

Update this document after every project change or file addition, including small fixes, documentation, configuration, assets, renames, and removals. Refresh the affected sections in the same change; do not leave the update for a later task.

## 1. Project overview

Swipe Archiver is a browser-only, user-local SillyTavern extension. It previews historical assistant-message swipes directly in the original message DOM and can explicitly create a new branch from the previewed swipe. It targets the local SillyTavern release checkout at `SillyTavern/` and must never require a core or Moonlit Echoes modification.

The main architectural boundary is strict: preview state is an in-memory `Map` keyed by live message object identity, while every displayed alternate swipe is a `structuredClone()` projection. The branch operation is the only persistent action and saves a cloned snapshot rather than changing the source message then changing it back.

## 2. File and folder structure

```text
README.md                         User-facing feature, safety, install, and test guide
CONTEXT.md                        This maintainer handoff
swipe-archiver/
├── manifest.json                 User extension manifest
├── index.js                      UI, lifecycle, clone rendering, and branch persistence
├── core.js                       Pure clone/eligibility/snapshot/name helpers
├── style.css                     Scoped mobile-first theme-inheriting styles
├── package.json                  ESM configuration for deterministic tests
└── tests/core.test.mjs           Projection, branch, malformed-data, and stale-state tests
SillyTavern/                      Supplied release checkout and local runtime data; do not edit core
SillyTavern-MoonlitEchoesTheme/   Supplied theme source; do not edit it for this extension
```

`swipe-archiver/` is the maintained source. The expected installed runtime location is a Windows junction at `SillyTavern/data/default-user/extensions/swipe-archiver`; it should point at the maintained source rather than duplicate it.

## 3. Existing features or deliverables

- Eligible historical assistant messages gain a compact eye control in `.mes_block`. System and user messages, one-swipe messages, malformed swipe arrays, and the active/latest assistant message are excluded.
- Normal historical messages keep SillyTavern's original swipe counter; the eye occupies a separate lane outside it. Preview mode hides only that affected message's visual core swipe controls and shows its own temporary counter.
- Preview mode starts at the canonical `swipe_id`, maintains a separate per-message preview index, disables endpoints instead of wrapping, and restores the current canonical projection on close.
- Preview projection formats text with SillyTavern's formatter, including the safe transient formatter ID for message `0`; it rebuilds reasoning and media only from a clone.
- Native core swipe handling stays untouched. The extension suppresses only its own capture-phase clicks and hides the affected message's visual core arrow while a preview is active.
- The explicit `Create Branch` flow writes a cloned history snapshot through the selected message. Character branches use the native `/api/chats/save` request shape without `saveChat()`'s live character mutation. Group branches use the group save endpoint and persist the group branch registry after the cloned save succeeds.

## 4. Important implementation or workflow details

`core.js` is deliberately dependency-free and accepts `syncSwipeToMes` as an argument. `index.js` calls the core synchronizer only with a clone, never a value from `context.chat`.

Do not replace `renderProjection()` with `context.updateMessageBlock()`: the current core reasoning helper can initialize `chat[mesid].extra`, which violates the non-destructive contract. Preview text uses `context.messageFormatting()`; message `0` is passed as `-1` to avoid its greeting-specific live write path. Preview media calls `appendMediaToMessage()` with a clone because the helper may normalize media arrays.

Normal mode deliberately renders only the eye, never a duplicate count. With `body.swipeAllMessages` enabled, scoped CSS leaves the native `.swipes-counter` visible and reserves its 40px lane plus a small gap; in the tested Ripple layout the eye and counter hit boxes remain 11px apart. The `last_mes` DOM class is an explicit exclusion in `isHistoricalPreviewTarget()`, so native current-message swiping is not decorated or intercepted.

The extension listens to `CHAT_CHANGED`, render, swipe, edit, update, deletion, and lazy-load events. A narrow `#chat` observer clears all preview state when the prior direct message nodes are fully removed, preventing DOM-rebuild state leaks. Initialization is idempotent through `globalThis.__swipeArchiverExtension` and disposes old listeners before replacing an instance.

Branch metadata is cloned from the active chat metadata and adds `main_chat` plus a new integrity UUID. Do not use `branchChat()` or `createBranch()` from `bookmarks.js`: they append to `lastMes.extra.branches`, which would mutate the source chat. `saveItemizedPrompts(branchName)` follows a successful branch save before the new branch opens.

## 5. Project-specific rules and constraints

- Do not edit files inside `SillyTavern/` or `SillyTavern-MoonlitEchoesTheme/` for this feature.
- Previewing must not change the source message's `mes`, `swipe_id`, `swipes`, `swipe_info`, `extra`, metadata, ordering, JSONL file, save state, generation state, checkpoint state, or core events.
- Do not implement preview by temporarily selecting a swipe in the live chat object.
- Keep all UI inside the original `.mes_block`, scoped under `swipe-archiver__*`, native-looking, mobile-first, and compatible with Moonlit Echoes Ripple plus Rectangle avatars.
- Every CSS rule in `style.css` needs an explanatory comment. Use theme variables; do not hardcode theme colors or fonts.
- Preserve unrelated existing worktree changes, including the supplied SillyTavern and Moonlit source folders.

## 6. Current state

As of 2026-09-16, the extension source, manifest, scoped styles, deterministic tests, README, and this handoff have been created in the workspace. The requested local-user junction is installed at `SillyTavern/data/default-user/extensions/swipe-archiver` and points to the maintained `swipe-archiver/` source.

Static validation passed: manifest parsing, `node --check` for `index.js` and `core.js`, and all five deterministic Node tests. The supplied Seraphina JSONL has one historical multi-swipe assistant candidate (four swipes, canonical zero-based index `3`). Live browser validation was performed in the running local server with Moonlit Echoes Ripple, Rectangle avatars, and a 390px viewport: the control appeared only once, opened on the canonical swipe, preview navigation changed the visible projection only, and close restored the canonical display. The source JSONL SHA-256 stayed `526B5914727D7B4C396B29B211C85A853FB34F79E4806C2031BDBC797E52EF4F` before and after preview and branch testing.

One intentional test artifact exists: `Seraphina - 2023-5-12 @21h 32m 29s 224ms - Branch #1.jsonl`. It was created from noncanonical swipe 3 and opens with that swipe selected; the original JSONL and its source-message metadata stayed unchanged. The final UI refinement leaves the active/latest assistant message wholly native (its original arrows and counter remain); a historical message keeps its original `4/4` counter with a separate bare eye beside it, and preview shows the compact bare-chevron/close row plus the compact native-looking `Create Branch` button. These states were rechecked at 390px with Ripple and Rectangle avatars. No model/API call was made. No physical-device test has been performed.

## 7. Recommended testing or verification workflow

From this workspace root, run `node --check swipe-archiver/index.js`, `node --check swipe-archiver/core.js`, and `node --test swipe-archiver/tests/core.test.mjs`.

Validate the manifest with PowerShell `Get-Content -Raw swipe-archiver/manifest.json | ConvertFrom-Json`. Confirm `git -C SillyTavern status --short` remains clean and that the Moonlit worktree's pre-existing changes remain untouched.

For browser verification, use the already-running local server and open the supplied Seraphina chat. Hash the source JSONL before and after preview navigation. Verify the one eligible historical assistant message exposes a separate eye beside the original `4/4` counter, navigation changes only rendered DOM, close restores the original `4/4`, no save/generation/`MESSAGE_SWIPED` event occurs, and a 390px Ripple + Rectangle viewport has no horizontal overflow. Verify a last assistant message exposes only SillyTavern's native arrows and counter, with no Swipe Archiver eye. Separately create one noncanonical-swipe branch and compare the source message plus JSONL hash before/after; distinguish that intentional new branch artifact from the untouched source chat.
