# Swipe Archiver

<p align="center">
<a href="https://ibb.co/JFG9QcW1"><img src="https://i.ibb.co/wrPfsdZk/swipe-archiver-logo.png" alt="swipe archiver logo" border="0" width="50%"></a>
</p>

Swipe Archiver is a [SillyTavern](https://github.com/sillytavern/SillyTavern) UI extension for inspecting stored swipes on earlier assistant messages without changing the selected swipe or saving the source chat.

## Features

- Adds an eye control to ordinary assistant messages with two or more valid stored swipes.
- Opens a compact in-message preview row with previous/next controls, a one-based swipe count, `Create Branch`, and close.
- Renders preview text, reasoning, and media from a `structuredClone()` projection only.
- Restores the currently canonical swipe from a fresh clone when preview closes.
- Lets several messages hold independent in-memory preview positions.
- Clears preview state on chat changes, full message-DOM replacement, message deletion, and core swipe/edit/update reconciliation.
- Creates a branch from the previewed swipe without first making it canonical in the source chat.
- Adds a closed-by-default native SillyTavern drawer with an `Enable Swipe Archiver` checkbox.
- Refuses to disable while a preview is open, restores the checked state, and shows SillyTavern's native warning toast.

## Data-safety

> [!IMPORTANT]
> Previewing never writes to a live SillyTavern message object. In particular, it does not change `mes`, `swipe_id`, `swipes`, `swipe_info`, `extra`, chat metadata, the JSONL source file, or any normal swipe/generation/checkpoint path. The only persisted extension preference is the user-global `extensionSettings.swipe_archiver.enabled` flag; it controls whether extension-owned controls are rendered and never touches chat data.

> [!IMPORTANT]
> `Create Branch` is the sole persistent action. It builds a clone-only snapshot through the selected message, synchronizes the previewed swipe on that clone, saves the new branch, copies SillyTavern's itemized-prompt data when applicable, and opens the branch. It intentionally does not call SillyTavern's `branchChat()` helper because that helper records the new name in `sourceMessage.extra.branches`.

## Installation

### SillyTavern

Simply install it in SillyTavern by pasting the repo link.

### Manual

Clone the repo with `git clone` and then place it in your `default-user/extensions` folder

```bash
git clone
```

## Usage

<p align="center">
<a href="https://ibb.co/tMkTRmLb"><img src="https://i.ibb.co/4Z9nkm1j/swipe-archiver.gif" alt="swipe archiver" border="0" width="80%"></a>
</p>

1. Ensure the extension is enabled in the extensions drawer. If it isn't, enable it with the checkbox.
2. Open a chat and scroll to a previous assistant message. You should see an eye icon on the bottom of the message.
3. Click the eye. You are now in "Preview Mode". Here you can view previous swipes of said message.
4. Tap the chevrons to scroll through the swipes.
5. If you find one you like, click the "Create Branch" button. This will create a branch of your selected swipe. Your old chat is left intact, don't worry.
6. If you want to exit "Preview Mode" simply click the X on the left.
7. If you want to disable the extension, simply uncheck the checkbox in the extensions drawer.

## Compatibility

The footer is appended inside each eligible historical message's existing `.mes_block`, not as an overlay or separate message. The active/latest assistant message is left entirely to SillyTavern's native swipe UI. Historical messages keep SillyTavern's original swipe counter in normal mode, and Swipe Archiver adds only a separate eye control outside that counter; preview mode temporarily replaces those visual controls with its own read-only row.

The extension drawer uses SillyTavern's native `inline-drawer` markup and chevron. Its checkbox defaults to enabled when no preference has been saved; disabling removes only Swipe Archiver's rendered controls. A preview must be closed before disabling is allowed.
