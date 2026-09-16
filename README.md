# Swipe Archiver

Swipe Archiver is a user-local SillyTavern UI extension for inspecting stored swipes on earlier assistant messages without changing the selected swipe or saving the source chat.

## What it does

- Adds an eye control to ordinary assistant messages with two or more valid stored swipes.
- Opens a compact in-message preview row with previous/next controls, a one-based swipe count, `Create Branch`, and close.
- Renders preview text, reasoning, and media from a `structuredClone()` projection only.
- Restores the currently canonical swipe from a fresh clone when preview closes.
- Lets several messages hold independent in-memory preview positions.
- Clears preview state on chat changes, full message-DOM replacement, message deletion, and core swipe/edit/update reconciliation.
- Creates a branch from the previewed swipe without first making it canonical in the source chat.
- Adds a closed-by-default native SillyTavern drawer with an `Enable Swipe Archiver` checkbox.
- Refuses to disable while a preview is open, restores the checked state, and shows SillyTavern's native warning toast.

## Data-safety contract

Previewing never writes to a live SillyTavern message object. In particular, it does not change `mes`, `swipe_id`, `swipes`, `swipe_info`, `extra`, chat metadata, the JSONL source file, or any normal swipe/generation/checkpoint path. The only persisted extension preference is the user-global `extensionSettings.swipe_archiver.enabled` flag; it controls whether extension-owned controls are rendered and never touches chat data.

`Create Branch` is the sole persistent action. It builds a clone-only snapshot through the selected message, synchronizes the previewed swipe on that clone, saves the new branch, copies SillyTavern's itemized-prompt data when applicable, and opens the branch. It intentionally does not call SillyTavern's `branchChat()` helper because that helper records the new name in `sourceMessage.extra.branches`.

## Files

```text
swipe-archiver/
├── manifest.json       Extension manifest
├── index.js            Browser integration, clone-only rendering, lifecycle, and branch save path
├── core.js             Pure validation, clone projection, snapshot, and naming helpers
├── style.css           Theme-inheriting, mobile-first scoped UI styles
├── settings.html       Native closed-by-default extension-drawer template
├── package.json        ESM test configuration
└── tests/core.test.mjs Deterministic non-mutation tests
```

The editable source is this workspace's `swipe-archiver/` folder. The local SillyTavern installation receives it via a Windows junction at `SillyTavern/data/default-user/extensions/swipe-archiver`.

## Validation

From the workspace root:

```powershell
node --check swipe-archiver/index.js
node --check swipe-archiver/core.js
node --test swipe-archiver/tests/core.test.mjs
```

The browser checks should use the supplied Seraphina fixture in the already-running local SillyTavern instance. No model or API call is required because the feature only reads saved swipes.

## Compatibility

The footer is appended inside each eligible historical message's existing `.mes_block`, not as an overlay or separate message. This preserves Moonlit Echoes' Ripple chat layout and rectangular sticky-avatar column while remaining theme-inheriting in the normal SillyTavern layout.

The active/latest assistant message is left entirely to SillyTavern's native swipe UI. Historical messages keep SillyTavern's original swipe counter in normal mode, and Swipe Archiver adds only a separate eye control outside that counter; preview mode temporarily replaces those visual controls with its own read-only row.

The extension drawer uses SillyTavern's native `inline-drawer` markup and chevron. Its checkbox defaults to enabled when no preference has been saved; disabling removes only Swipe Archiver's rendered controls. A preview must be closed before disabling is allowed.
