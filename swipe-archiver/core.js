/**
 * Pure data helpers for Swipe Archiver.
 *
 * These functions deliberately receive the core swipe synchronizer as an
 * argument. That keeps every projection clone-only and makes the safety
 * contract straightforward to exercise in Node without a SillyTavern page.
 */

/**
 * Returns whether every saved swipe is a string SillyTavern can render.
 * Malformed arrays fail closed rather than exposing a partial or unsafe viewer.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function hasValidStoredSwipes(message) {
    return Boolean(
        message
        && typeof message === 'object'
        && Array.isArray(message.swipes)
        && message.swipes.length >= 2
        && message.swipes.every((swipe) => typeof swipe === 'string'),
    );
}

/**
 * Gets the canonical zero-based swipe index, or null for invalid data.
 *
 * @param {unknown} message
 * @returns {number|null}
 */
export function getCanonicalSwipeIndex(message) {
    if (!hasValidStoredSwipes(message)) {
        return null;
    }

    const index = message.swipe_id;
    if (!Number.isInteger(index) || index < 0 || index >= message.swipes.length) {
        return null;
    }

    return index;
}

/**
 * Limits the feature to ordinary assistant messages with a valid canonical
 * selection. System messages, user messages, and malformed data are ignored.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isPreviewEligible(message) {
    return Boolean(
        message
        && typeof message === 'object'
        && !message.is_user
        && !message.is_system
        && getCanonicalSwipeIndex(message) !== null,
    );
}

/**
 * Produces an isolated clone whose `mes` and swipe-dependent fields represent
 * one stored swipe. The source message is never passed to the synchronizer.
 *
 * @param {object} message
 * @param {number} swipeIndex
 * @param {(messageId: number|null, swipeId: number|null, targetMessage: object) => boolean} syncSwipeToMes
 * @returns {object|null}
 */
export function createSwipeProjection(message, swipeIndex, syncSwipeToMes) {
    if (!isPreviewEligible(message) || !Number.isInteger(swipeIndex)) {
        return null;
    }

    if (swipeIndex < 0 || swipeIndex >= message.swipes.length || typeof syncSwipeToMes !== 'function') {
        return null;
    }

    let projection;
    try {
        projection = structuredClone(message);
    } catch {
        return null;
    }

    return syncSwipeToMes(null, swipeIndex, projection) ? projection : null;
}

/**
 * Creates the persistent branch payload without sharing nested objects with the
 * live chat. Only the final snapshot message is synchronized to the requested
 * previewed swipe.
 *
 * @param {object[]} chat
 * @param {number} messageId
 * @param {number} swipeIndex
 * @param {(messageId: number|null, swipeId: number|null, targetMessage: object) => boolean} syncSwipeToMes
 * @returns {object[]|null}
 */
export function createBranchSnapshot(chat, messageId, swipeIndex, syncSwipeToMes) {
    if (!Array.isArray(chat) || !Number.isInteger(messageId) || messageId < 0 || messageId >= chat.length) {
        return null;
    }

    let snapshot;
    try {
        snapshot = structuredClone(chat.slice(0, messageId + 1));
    } catch {
        return null;
    }

    const selectedMessage = snapshot[messageId];
    if (!isPreviewEligible(selectedMessage) || !Number.isInteger(swipeIndex)) {
        return null;
    }

    if (swipeIndex < 0 || swipeIndex >= selectedMessage.swipes.length || typeof syncSwipeToMes !== 'function') {
        return null;
    }

    return syncSwipeToMes(null, swipeIndex, selectedMessage) ? snapshot : null;
}

/**
 * Builds SillyTavern-compatible branch names without changing the source chat
 * name or metadata.
 *
 * @param {string} sourceName
 * @param {number} index
 * @returns {string}
 */
export function buildBranchName(sourceName, index) {
    const fallbackName = 'Chat';
    const normalizedIndex = Math.max(1, Number.isInteger(index) ? index : 1);
    const baseName = String(sourceName || fallbackName)
        .replace(/ - Branch #\d+$/, '')
        .replace(/^Branch #\d+ - /, '') || fallbackName;

    return `${baseName} - Branch #${normalizedIndex}`;
}

/**
 * Picks the first unused branch name from a collection of existing names.
 *
 * @param {string} sourceName
 * @param {Iterable<string>} existingNames
 * @returns {string}
 */
export function chooseUniqueBranchName(sourceName, existingNames) {
    const names = new Set(Array.from(existingNames, (name) => String(name)));
    let index = 1;

    while (names.has(buildBranchName(sourceName, index))) {
        index += 1;
    }

    return buildBranchName(sourceName, index);
}

/**
 * Removes preview states whose message objects no longer belong to the live
 * chat array. It is intentionally identity-based, not mesid-based.
 *
 * @param {Map<object, object>} previewStates
 * @param {object[]} liveChat
 * @returns {number}
 */
export function prunePreviewStates(previewStates, liveChat) {
    if (!(previewStates instanceof Map) || !Array.isArray(liveChat)) {
        return 0;
    }

    const liveMessages = new Set(liveChat);
    let removed = 0;
    for (const message of previewStates.keys()) {
        if (!liveMessages.has(message)) {
            previewStates.delete(message);
            removed += 1;
        }
    }

    return removed;
}
