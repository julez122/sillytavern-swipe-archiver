import { getContext } from '../../../st-context.js';
import { addCopyToCodeBlocks, saveItemizedPrompts, syncSwipeToMes } from '../../../../script.js';
import { compressRequest } from '../../../request-compression.js';

import {
    chooseUniqueBranchName,
    createBranchSnapshot,
    createSwipeProjection,
    getCanonicalSwipeIndex,
    isPreviewEligible,
    prunePreviewStates,
} from './core.js';

const EXTENSION_KEY = '__swipeArchiverExtension';
const FOOTER_SELECTOR = '.swipe-archiver__footer';
const ACTION_SELECTOR = '[data-swipe-archiver-action]';
const SETTINGS_KEY = 'swipe_archiver';
const SETTINGS_PANEL_ID = 'swipe-archiver-settings';
const ENABLE_INPUT_ID = 'swipe-archiver-enabled';
const DEFAULT_SETTINGS = Object.freeze({ enabled: true });

/**
 * Keeps Swipe Archiver limited to historical assistant messages. The current
 * last message belongs to SillyTavern's native swipe UI and is left entirely
 * untouched, including its counter and arrows.
 *
 * @param {Element|null} messageElement
 * @param {unknown} message
 * @returns {boolean}
 */
function isHistoricalPreviewTarget(messageElement, message) {
    return Boolean(
        messageElement
        && !messageElement.classList.contains('last_mes')
        && isPreviewEligible(message),
    );
}

/**
 * Renders stored assistant swipes without ever assigning to a live chat
 * message. Persistent work happens only after the explicit Create Branch click.
 */
class SwipeArchiver {
    constructor() {
        /** @type {Map<object, {previewIndex: number, creatingBranch: boolean}>} */
        this.previewStates = new Map();
        this.chatObserver = null;
        this.observedChat = null;
        this.lastKnownMessageNodes = new Set();
        this.reconcileQueued = false;
        this.boundListeners = [];
        this.settingsPanel = null;
        this.settingsInput = null;
        this.disposed = false;
        this.handleControlClick = this.handleControlClick.bind(this);
this.handleEnabledInputChange = this.handleEnabledInputChange.bind(this);
this.handlePreviewSwipeGesture = this.handlePreviewSwipeGesture.bind(this);
    }

    initialize() {
    document.addEventListener('click', this.handleControlClick, true);
    document.addEventListener('swiped-left', this.handlePreviewSwipeGesture, true);
    document.addEventListener('swiped-right', this.handlePreviewSwipeGesture, true);

    const context = getContext();
        this.getSettings();
        this.bindEvent(context.eventTypes.APP_READY, () => void this.mountSettingsPanel());
        void this.mountSettingsPanel();
        this.bindEvent(context.eventTypes.CHAT_CHANGED, () => {
            this.clearPreviewStates();
            this.scheduleReconcile();
        });
        this.bindEvent(context.eventTypes.MORE_MESSAGES_LOADED, () => this.scheduleReconcile());
        this.bindEvent(context.eventTypes.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            this.exitPreviewForMessageId(messageId, { restore: false });
            this.scheduleReconcile();
        });
        this.bindEvent(context.eventTypes.MESSAGE_SWIPED, (messageId) => {
            this.exitPreviewForMessageId(messageId, { restore: false });
            this.scheduleReconcile();
        });
        this.bindEvent(context.eventTypes.MESSAGE_UPDATED, (messageId) => {
            this.exitPreviewForMessageId(messageId, { restore: false });
            this.scheduleReconcile();
        });
        this.bindEvent(context.eventTypes.MESSAGE_EDITED, (messageId) => {
            this.exitPreviewForMessageId(messageId, { restore: false });
            this.scheduleReconcile();
        });
        this.bindEvent(context.eventTypes.MESSAGE_SWIPE_DELETED, (details) => {
            this.exitPreviewForMessageId(details?.messageId, { restore: false });
            this.scheduleReconcile();
        });
        this.bindEvent(context.eventTypes.MESSAGE_DELETED, () => {
            this.clearPreviewStates();
            this.scheduleReconcile();
        });

        this.observeChatDom();
        this.scheduleReconcile();
    }

    dispose() {
    this.disposed = true;
    document.removeEventListener('click', this.handleControlClick, true);
    document.removeEventListener('swiped-left', this.handlePreviewSwipeGesture, true);
    document.removeEventListener('swiped-right', this.handlePreviewSwipeGesture, true);
    this.chatObserver?.disconnect();
        this.chatObserver = null;
        this.observedChat = null;
        this.lastKnownMessageNodes.clear();
        this.removeSettingsPanel();

        const context = getContext();
        for (const [eventType, handler] of this.boundListeners) {
            context.eventSource.removeListener(eventType, handler);
        }
        this.boundListeners = [];
        this.clearPreviewStates({ restore: true });
    }

    /**
     * Registers a removable event listener on SillyTavern's event source.
     *
     * @param {string|undefined} eventType
     * @param {Function} handler
     */
    bindEvent(eventType, handler) {
        if (!eventType) {
            return;
        }

        const context = getContext();
        context.eventSource.on(eventType, handler);
        this.boundListeners.push([eventType, handler]);
    }

    /**
     * Gets the extension-owned, global preference while preserving unrelated
     * fields. This controls only the extension's DOM behavior, never chat
     * data or message state.
     *
     * @returns {{enabled: boolean, [key: string]: unknown}}
     */
    getSettings() {
        const context = getContext();
        const settingsStore = context.extensionSettings;
        if (!settingsStore || typeof settingsStore !== 'object') {
            return { ...DEFAULT_SETTINGS };
        }

        let settings = settingsStore[SETTINGS_KEY];
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            settings = { ...DEFAULT_SETTINGS };
            settingsStore[SETTINGS_KEY] = settings;
        }

        if (typeof settings.enabled !== 'boolean') {
            settings.enabled = DEFAULT_SETTINGS.enabled;
        }

        return settings;
    }

    /**
     * @returns {boolean}
     */
    isEnabled() {
        return this.getSettings().enabled;
    }

    /**
     * Mounts one native SillyTavern inline drawer. Its content begins hidden
     * through the platform's .inline-drawer-content rule, so it is closed by
     * default without adding custom collapse styling.
     */
    async mountSettingsPanel() {
        if (this.disposed) {
            return;
        }

        const existingPanel = document.getElementById(SETTINGS_PANEL_ID);
        if (existingPanel) {
            this.settingsPanel = existingPanel;
            this.bindSettingsInput(existingPanel);
            return;
        }

        const context = getContext();
        const container = document.querySelector('#extensions_settings2');
        if (!container || typeof context.renderExtensionTemplateAsync !== 'function') {
            return;
        }

        try {
            const settingsHtml = await context.renderExtensionTemplateAsync('third-party/swipe-archiver', 'settings');
            if (this.disposed || document.getElementById(SETTINGS_PANEL_ID) || !container.isConnected) {
                return;
            }

            container.insertAdjacentHTML('beforeend', settingsHtml);
            const settingsPanel = document.getElementById(SETTINGS_PANEL_ID);
            if (!settingsPanel) {
                throw new Error('The settings template did not contain its root element.');
            }

            this.settingsPanel = settingsPanel;
            this.bindSettingsInput(settingsPanel);
        } catch (error) {
            console.error('[Swipe Archiver] Settings panel could not be mounted.', error);
        }
    }

    /**
     * @param {HTMLElement} settingsPanel
     */
    bindSettingsInput(settingsPanel) {
        const input = settingsPanel.querySelector(`#${ENABLE_INPUT_ID}`);
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        this.settingsInput?.removeEventListener('change', this.handleEnabledInputChange);
        this.settingsInput = input;
        input.removeEventListener('change', this.handleEnabledInputChange);
        input.addEventListener('change', this.handleEnabledInputChange);
        input.checked = this.isEnabled();
    }

    /**
     * @param {Event} event
     */
    handleEnabledInputChange(event) {
        const input = event.currentTarget;
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const nextEnabled = input.checked;
        prunePreviewStates(this.previewStates, getContext().chat);
        if (!nextEnabled && this.previewStates.size > 0) {
            input.checked = true;
            this.notify('warning', 'Close the active swipe preview before disabling Swipe Archiver.', 'Swipe Archiver');
            return;
        }

        const settings = this.getSettings();
        if (settings.enabled === nextEnabled) {
            return;
        }

        settings.enabled = nextEnabled;
        getContext().saveSettingsDebounced?.();
        if (nextEnabled) {
            this.scheduleReconcile();
        } else {
            this.removeRenderedControls();
        }
    }

    /**
     * Removes only extension-owned DOM when the feature is turned off. It
     * cannot write, save, or otherwise alter any chat or message object.
     */
    removeRenderedControls() {
        for (const messageElement of document.querySelectorAll('#chat .mes')) {
            messageElement.querySelector(FOOTER_SELECTOR)?.remove();
            messageElement.classList.remove('swipe-archiver--managed', 'swipe-archiver--previewing');
        }
    }

    /**
     * Removes the panel and its direct listener during an idempotent reload.
     */
    removeSettingsPanel() {
        this.settingsInput?.removeEventListener('change', this.handleEnabledInputChange);
        this.settingsInput = null;
        this.settingsPanel?.remove();
        this.settingsPanel = null;
    }

    /**
     * Keeps a narrow observer on #chat so a full clear/rebuild invalidates all
     * in-memory preview states instead of carrying them into replacement DOM.
     */
    observeChatDom() {
        const chat = document.querySelector('#chat');
        if (chat === this.observedChat) {
            return;
        }

        this.chatObserver?.disconnect();
        this.observedChat = chat;
        this.lastKnownMessageNodes = new Set(chat?.querySelectorAll(':scope > .mes') ?? []);

        if (!chat) {
            return;
        }

        this.chatObserver = new MutationObserver((records) => {
            const removedNodes = new Set();
            for (const record of records) {
                for (const node of record.removedNodes) {
                    if (node instanceof Element && node.matches('.mes')) {
                        removedNodes.add(node);
                    }
                }
            }

            const allPreviousMessagesRemoved = this.lastKnownMessageNodes.size > 0
                && [...this.lastKnownMessageNodes].every((node) => removedNodes.has(node));
            if (allPreviousMessagesRemoved) {
                this.clearPreviewStates();
            }

            this.lastKnownMessageNodes = new Set(chat.querySelectorAll(':scope > .mes'));
            this.scheduleReconcile();
        });
        this.chatObserver.observe(chat, { childList: true });
    }

    scheduleReconcile() {
        if (this.reconcileQueued) {
            return;
        }

        this.reconcileQueued = true;
        requestAnimationFrame(() => {
            this.reconcileQueued = false;
            this.reconcile();
        });
    }

    /**
     * Adds/removes only extension-owned controls and abandons stale preview
     * states before touching the visible chat.
     */
    reconcile() {
        this.observeChatDom();
        if (!this.isEnabled()) {
            this.removeRenderedControls();
            return;
        }

        const context = getContext();
        const chat = context.chat;
        prunePreviewStates(this.previewStates, chat);

        for (const [message] of this.previewStates) {
            const messageId = chat.indexOf(message);
            if (messageId < 0 || !this.getMessageElement(messageId)) {
                this.previewStates.delete(message);
            }
        }

        for (const messageElement of document.querySelectorAll('#chat .mes[mesid]')) {
            const messageId = Number(messageElement.getAttribute('mesid'));
            const message = chat[messageId];
            if (!Number.isInteger(messageId) || !message || !isHistoricalPreviewTarget(messageElement, message)) {
                if (message && this.previewStates.has(message)) {
                    // A previously historical message can become current after
                    // a DOM rebuild. Restore only from a clone before releasing
                    // it back to SillyTavern's native current-message controls.
                    this.previewStates.delete(message);
                    if (isPreviewEligible(message)) {
                        this.renderCanonicalProjection(messageElement, message, messageId);
                    }
                }
                messageElement.classList.remove('swipe-archiver--managed', 'swipe-archiver--previewing');
                messageElement.querySelector(FOOTER_SELECTOR)?.remove();
                continue;
            }

            const state = this.previewStates.get(message);
            if (state) {
                const projection = createSwipeProjection(message, state.previewIndex, syncSwipeToMes);
                if (projection && this.renderProjection(messageElement, projection, messageId, context)) {
                    messageElement.classList.add('swipe-archiver--previewing');
                } else {
                    this.previewStates.delete(message);
                    messageElement.classList.remove('swipe-archiver--previewing');
                }
            } else {
                messageElement.classList.remove('swipe-archiver--previewing');
            }

            this.renderFooter(messageElement, message, messageId);
        }

        this.lastKnownMessageNodes = new Set(document.querySelectorAll('#chat > .mes'));
    }

    /**
     * Uses a clone that represents the current canonical selection. This is the
     * only restoration path; no cached text is ever copied back to a message.
     *
     * @param {Element} messageElement
     * @param {object} message
     * @param {number} messageId
     * @returns {boolean}
     */
    renderCanonicalProjection(messageElement, message, messageId) {
        const canonicalSwipeIndex = getCanonicalSwipeIndex(message);
        if (canonicalSwipeIndex === null) {
            return false;
        }

        const projection = createSwipeProjection(message, canonicalSwipeIndex, syncSwipeToMes);
        return Boolean(projection && this.renderProjection(messageElement, projection, messageId, getContext()));
    }

    /**
     * Changes rendered DOM from a safe clone. The live `context.chat` message
     * is never passed to formatting, media, or reasoning helpers here.
     *
     * @param {Element} messageElement
     * @param {object} projection
     * @param {number} messageId
     * @param {ReturnType<typeof getContext>} context
     * @returns {boolean}
     */
    renderProjection(messageElement, projection, messageId, context) {
        const messageText = messageElement.querySelector('.mes_text');
        if (!messageText) {
            return false;
        }

        // messageFormatting special-cases live message 0, so a transient id
        // prevents a greeting preview from ever writing to context.chat[0].
        const formatterMessageId = messageId === 0 ? -1 : messageId;
        let formattedText;
        try {
            formattedText = context.messageFormatting(
                String(projection.mes ?? ''),
                String(projection.name ?? ''),
                Boolean(projection.is_system),
                Boolean(projection.is_user),
                formatterMessageId,
            );
        } catch (error) {
            console.warn('[Swipe Archiver] Preview formatting failed.', error);
            return false;
        }

        messageText.innerHTML = formattedText;
        addCopyToCodeBlocks(messageElement);
        this.renderReasoningProjection(messageElement, projection, formatterMessageId, context);
        this.renderMediaProjection(messageElement, projection, context);
        return true;
    }

    /**
     * Mirrors only the display-facing reasoning fields from the clone. It does
     * not use the core reasoning handler because that handler can initialize a
     * missing `extra` object on the live message.
     */
    renderReasoningProjection(messageElement, projection, formatterMessageId, context) {
        const details = messageElement.querySelector('.mes_reasoning_details');
        const reasoningContent = messageElement.querySelector('.mes_reasoning');
        if (!details || !reasoningContent) {
            return;
        }

        const extra = projection?.extra && typeof projection.extra === 'object' ? projection.extra : {};
        const rawReasoning = extra.reasoning_display_text ?? extra.reasoning ?? '';
        const hasReasoning = Boolean(extra.reasoning || extra.reasoning_display_text);
        const state = hasReasoning ? 'done' : extra.reasoning_duration ? 'hidden' : 'none';

        messageElement.classList.toggle('reasoning', state !== 'none');
        if (state === 'none') {
            delete messageElement.dataset.reasoningState;
            delete details.dataset.state;
            delete details.dataset.type;
            delete details.dataset.hasContent;
            reasoningContent.replaceChildren();
            return;
        }

        messageElement.dataset.reasoningState = state;
        details.dataset.state = state;
        if (extra.reasoning_type) {
            details.dataset.type = String(extra.reasoning_type);
        } else {
            delete details.dataset.type;
        }

        const hasVisibleContent = Boolean(String(rawReasoning).trim());
        if (hasVisibleContent) {
            details.dataset.hasContent = 'true';
        } else {
            delete details.dataset.hasContent;
        }

        try {
            reasoningContent.innerHTML = context.messageFormatting(
                String(rawReasoning).trim(),
                '',
                false,
                false,
                formatterMessageId,
                {},
                true,
            );
        } catch (error) {
            console.warn('[Swipe Archiver] Preview reasoning formatting failed.', error);
            reasoningContent.replaceChildren();
        }

        // Keep the user's existing expanded/collapsed details state. It belongs
        // to the live DOM, not to a stored swipe, and must survive closing the
        // temporary preview unchanged.
    }

    /**
     * Rebuilds only the extension-visible media slots from a clone. Core media
     * utilities may normalize `extra.media`, so the clone is intentional.
     */
    renderMediaProjection(messageElement, projection, context) {
        const mediaWrapper = messageElement.querySelector('.mes_media_wrapper');
        const fileWrapper = messageElement.querySelector('.mes_file_wrapper');
        mediaWrapper?.replaceChildren();
        fileWrapper?.replaceChildren();
        messageElement.removeAttribute('data-media-display');
        messageElement.querySelector('.mes_text')?.classList.remove('inline_media');

        if (typeof globalThis.$ !== 'function' || typeof context.appendMediaToMessage !== 'function') {
            return;
        }

        try {
            context.appendMediaToMessage(projection, globalThis.$(messageElement), 'none');
        } catch (error) {
            console.warn('[Swipe Archiver] Preview media rendering failed.', error);
        }
    }

    /**
     * Creates the compact normal or preview control row inside .mes_block.
     *
     * @param {Element} messageElement
     * @param {object} message
     * @param {number} messageId
     */
    renderFooter(messageElement, message, messageId) {
        messageElement.querySelector(FOOTER_SELECTOR)?.remove();

        if (!this.isEnabled() || !isHistoricalPreviewTarget(messageElement, message)) {
            messageElement.classList.remove('swipe-archiver--managed', 'swipe-archiver--previewing');
            return;
        }

        const messageBlock = messageElement.querySelector('.mes_block');
        if (!messageBlock) {
            return;
        }

        messageElement.classList.add('swipe-archiver--managed');
        const state = this.previewStates.get(message);
        const total = message.swipes.length;
        const footer = document.createElement('div');
        footer.className = 'swipe-archiver__footer';
        footer.dataset.swipeArchiverMesid = String(messageId);

        if (!state) {
            footer.append(this.createButton({
                action: 'open',
                className: 'swipe-archiver__open',
                title: 'Preview stored swipes',
                label: 'Preview stored swipes',
                icon: 'fa-eye',
            }));
            messageBlock.append(footer);
            return;
        }

        footer.append(
            this.createButton({
                action: 'previous',
                className: 'swipe-archiver__arrow',
                title: 'Previous preview swipe',
                label: 'Previous preview swipe',
                icon: 'fa-chevron-left',
                disabled: state.previewIndex <= 0 || state.creatingBranch,
            }),
            this.createPreviewCounter(state.previewIndex, total),
            this.createButton({
                action: 'next',
                className: 'swipe-archiver__arrow',
                title: 'Next preview swipe',
                label: 'Next preview swipe',
                icon: 'fa-chevron-right',
                disabled: state.previewIndex >= total - 1 || state.creatingBranch,
            }),
            this.createButton({
                action: 'branch',
                className: 'swipe-archiver__branch',
                title: 'Create a branch from this previewed swipe',
                label: 'Create Branch',
                text: state.creatingBranch ? 'Creating…' : 'Create Branch',
                disabled: state.creatingBranch,
            }),
            this.createButton({
                action: 'close',
                className: 'swipe-archiver__close',
                title: 'Exit swipe preview',
                label: 'Exit swipe preview',
                icon: 'fa-xmark',
                disabled: state.creatingBranch,
            }),
        );
        messageBlock.append(footer);
    }

    /**
     * @param {{action: string, className: string, title: string, label: string, icon?: string, text?: string, disabled?: boolean}} options
     * @returns {HTMLButtonElement}
     */
    createButton({ action, className, title, label, icon, text, disabled = false }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `menu_button ${className}`;
        button.dataset.swipeArchiverAction = action;
        button.title = title;
        button.setAttribute('aria-label', label);
        button.disabled = disabled;

        if (icon) {
            const iconElement = document.createElement('i');
            iconElement.className = `fa-solid ${icon}`;
            iconElement.setAttribute('aria-hidden', 'true');
            button.append(iconElement);
        }

        if (text) {
            const textElement = document.createElement('span');
            textElement.className = 'swipe-archiver__button-text';
            textElement.textContent = text;
            button.append(textElement);
        }

        return button;
    }

    /**
     * @param {number} previewIndex
     * @param {number} total
     * @returns {HTMLSpanElement}
     */
    createPreviewCounter(previewIndex, total) {
        const counter = document.createElement('span');
        counter.className = 'swipe-archiver__preview-count';
        counter.setAttribute('aria-live', 'polite');
        counter.textContent = `${previewIndex + 1}/${total}`;
        return counter;
    }
/**
 * Blocks SillyTavern's native horizontal swipe gesture while any historical
 * swipe preview is open. This prevents a phone gesture from swiping the
 * latest assistant message while the user is inspecting an older message.
 *
 * @param {CustomEvent} event
 */
handlePreviewSwipeGesture(event) {
    if (!this.isEnabled() || this.previewStates.size === 0) {
        return;
    }

    const target = event.target instanceof Element ? event.target : null;

    if (!target?.closest('#chat')) {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
}
    /**
     * Capture-phase delegation guarantees a custom preview button cannot bubble
     * into SillyTavern's normal swipe handlers on the same document.
     *
     * @param {MouseEvent} event
     */
    handleControlClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const actionElement = target?.closest(ACTION_SELECTOR);
        if (!actionElement) {
            return;
        }

        const footer = actionElement.closest(FOOTER_SELECTOR);
        const messageId = Number(footer?.dataset.swipeArchiverMesid);
        if (!Number.isInteger(messageId) || actionElement instanceof HTMLButtonElement && actionElement.disabled) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        void this.handleAction(String(actionElement.dataset.swipeArchiverAction), messageId);
    }

    /**
     * @param {string} action
     * @param {number} messageId
     */
    async handleAction(action, messageId) {
        const context = getContext();
        const message = context.chat[messageId];
        const messageElement = this.getMessageElement(messageId);
        if (!this.isEnabled() || !message || !messageElement || !isHistoricalPreviewTarget(messageElement, message)) {
            if (message && this.previewStates.has(message)) {
                this.exitPreview(message, { restore: true });
            }
            this.scheduleReconcile();
            return;
        }

        if (action === 'open') {
            this.enterPreview(message, messageElement, messageId);
            return;
        }

        if (action === 'close') {
            this.exitPreview(message, { restore: true });
            return;
        }

        const state = this.previewStates.get(message);
        if (!state || state.creatingBranch) {
            return;
        }

        if (action === 'previous' || action === 'next') {
            const offset = action === 'previous' ? -1 : 1;
            const nextIndex = Math.min(Math.max(state.previewIndex + offset, 0), message.swipes.length - 1);
            if (nextIndex === state.previewIndex) {
                return;
            }

            const projection = createSwipeProjection(message, nextIndex, syncSwipeToMes);
            if (!projection || !this.renderProjection(messageElement, projection, messageId, context)) {
                this.exitPreview(message, { restore: true });
                return;
            }

            state.previewIndex = nextIndex;
            messageElement.classList.add('swipe-archiver--previewing');
            this.renderFooter(messageElement, message, messageId);
            return;
        }

        if (action === 'branch') {
            await this.createBranch(message, messageId, state);
        }
    }

    /**
     * @param {object} message
     * @param {Element} messageElement
     * @param {number} messageId
     */
    enterPreview(message, messageElement, messageId) {
        if (!this.isEnabled() || !isHistoricalPreviewTarget(messageElement, message)) {
            return;
        }

        const canonicalSwipeIndex = getCanonicalSwipeIndex(message);
        if (canonicalSwipeIndex === null) {
            return;
        }

        const projection = createSwipeProjection(message, canonicalSwipeIndex, syncSwipeToMes);
        if (!projection || !this.renderProjection(messageElement, projection, messageId, getContext())) {
            return;
        }

        this.previewStates.set(message, { previewIndex: canonicalSwipeIndex, creatingBranch: false });
        messageElement.classList.add('swipe-archiver--previewing');
        this.renderFooter(messageElement, message, messageId);
    }

    /**
     * @param {number|unknown} messageId
     * @param {{restore?: boolean}} [options]
     */
    exitPreviewForMessageId(messageId, { restore = false } = {}) {
        if (!Number.isInteger(Number(messageId))) {
            return;
        }

        const message = getContext().chat[Number(messageId)];
        if (message && this.previewStates.has(message)) {
            this.exitPreview(message, { restore });
        }
    }

    /**
     * @param {object} message
     * @param {{restore?: boolean}} [options]
     */
    exitPreview(message, { restore = true } = {}) {
        if (!this.previewStates.has(message)) {
            return;
        }

        this.previewStates.delete(message);
        const context = getContext();
        const messageId = context.chat.indexOf(message);
        const messageElement = messageId >= 0 ? this.getMessageElement(messageId) : null;
        if (!messageElement) {
            return;
        }

        if (restore) {
            this.renderCanonicalProjection(messageElement, message, messageId);
        }

        messageElement.classList.remove('swipe-archiver--previewing');
        this.renderFooter(messageElement, message, messageId);
    }

    /**
     * Clears all extension-only state. Chat changes and DOM rebuilds use the
     * non-rendering default because the old DOM is about to be discarded.
     *
     * @param {{restore?: boolean}} [options]
     */
    clearPreviewStates({ restore = false } = {}) {
        const messages = [...this.previewStates.keys()];
        if (restore) {
            for (const message of messages) {
                this.exitPreview(message, { restore: true });
            }
            return;
        }

        this.previewStates.clear();
        for (const messageElement of document.querySelectorAll('#chat .mes.swipe-archiver--previewing')) {
            messageElement.classList.remove('swipe-archiver--previewing');
        }
    }

    /**
     * @param {number} messageId
     * @returns {Element|null}
     */
    getMessageElement(messageId) {
        return document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    }

    /**
     * Creates a branch snapshot, writes only that clone, then opens the new
     * chat. Neither the live message nor its `extra.branches` array is touched.
     *
     * @param {object} message
     * @param {number} messageId
     * @param {{previewIndex: number, creatingBranch: boolean}} state
     */
    async createBranch(message, messageId, state) {
        const context = getContext();
        if (context.chat[messageId] !== message || this.previewStates.get(message) !== state) {
            return;
        }

        const snapshot = createBranchSnapshot(context.chat, messageId, state.previewIndex, syncSwipeToMes);
        if (!snapshot) {
            this.notify('warning', 'The selected swipe could not be prepared for branching.', 'Create Branch');
            return;
        }

        const sourceChatId = context.chatId;
        if (!sourceChatId) {
            this.notify('warning', 'Open a saved chat before creating a branch.', 'Create Branch');
            return;
        }

        state.creatingBranch = true;
        const messageElement = this.getMessageElement(messageId);
        if (messageElement) {
            this.renderFooter(messageElement, message, messageId);
        }

        try {
            const existingNames = await this.getExistingChatNames(context);
            const branchName = chooseUniqueBranchName(sourceChatId, existingNames);
            const metadata = this.createBranchMetadata(context, sourceChatId);

            if (context.groupId) {
                await this.saveGroupBranch(context, branchName, metadata, snapshot);
            } else {
                await this.saveCharacterBranch(context, branchName, metadata, snapshot);
            }

            // A chat switch while the request was in flight must not copy the
            // wrong prompt cache or navigate away from the user's new chat.
            const currentContext = getContext();
            if (currentContext.chatId !== sourceChatId) {
                this.notify('info', `Created ${branchName}. It was not opened because the active chat changed.`, 'Create Branch');
                return;
            }

            await saveItemizedPrompts(branchName);
            this.exitPreview(message, { restore: true });
            if (context.groupId) {
                await context.openGroupChat(context.groupId, branchName);
            } else {
                await context.openCharacterChat(branchName);
            }
        } catch (error) {
            console.error('[Swipe Archiver] Branch creation failed.', error);
            this.notify('error', error instanceof Error ? error.message : 'The branch could not be created.', 'Create Branch');
        } finally {
            const activeState = this.previewStates.get(message);
            if (activeState === state) {
                state.creatingBranch = false;
                const currentMessageId = getContext().chat.indexOf(message);
                const currentMessageElement = currentMessageId >= 0 ? this.getMessageElement(currentMessageId) : null;
                if (currentMessageElement) {
                    this.renderFooter(currentMessageElement, message, currentMessageId);
                }
            }
        }
    }

    /**
     * @param {ReturnType<typeof getContext>} context
     * @returns {Promise<string[]>}
     */
    async getExistingChatNames(context) {
        if (context.groupId) {
            const group = context.groups.find((candidate) => candidate.id === context.groupId);
            return Array.isArray(group?.chats) ? [...group.chats] : [];
        }

        const character = context.characters[context.characterId];
        if (!character) {
            throw new Error('No character is selected.');
        }

        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: character.avatar, simple: true }),
        });
        if (!response.ok) {
            throw new Error('Could not read existing branch names.');
        }

        const data = await response.json();
        return Object.values(data ?? {})
            .map((entry) => String(entry?.file_name ?? '').replace(/\.jsonl$/, ''))
            .filter(Boolean);
    }

    /**
     * @param {ReturnType<typeof getContext>} context
     * @param {string} sourceChatId
     * @returns {object}
     */
    createBranchMetadata(context, sourceChatId) {
        let metadata = {};
        try {
            metadata = structuredClone(context.chatMetadata ?? {});
        } catch {
            // Metadata in a loaded chat should be JSON-like; fail safely if a
            // third-party extension put a non-cloneable value in it.
            metadata = {};
        }

        metadata.main_chat = sourceChatId;
        metadata.integrity = typeof context.uuidv4 === 'function'
            ? context.uuidv4()
            : globalThis.crypto?.randomUUID?.();
        return metadata;
    }

    /**
     * Uses SillyTavern's character save request contract with the cloned
     * snapshot. It deliberately avoids saveChat(), which updates the live
     * character record even when supplied chatData is a separate snapshot.
     */
    async saveCharacterBranch(context, branchName, metadata, snapshot) {
        const character = context.characters[context.characterId];
        if (!character) {
            throw new Error('No character is selected.');
        }

        const header = {
            chat_metadata: metadata,
            user_name: 'unused',
            character_name: 'unused',
        };
        const request = await compressRequest({
            method: 'POST',
            cache: 'no-cache',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                ch_name: character.name,
                file_name: branchName,
                chat: [header, ...snapshot],
                avatar_url: character.avatar,
                force: false,
            }),
        });
        const response = await fetch('/api/chats/save', request);
        if (!response.ok) {
            throw await this.responseError(response, 'The character branch could not be saved.');
        }
    }

    /**
     * Saves a group branch snapshot first, then persists its normal group chat
     * registry. The source chat messages are never part of either mutable step.
     */
    async saveGroupBranch(context, branchName, metadata, snapshot) {
        const group = context.groups.find((candidate) => candidate.id === context.groupId);
        if (!group || !Array.isArray(group.chats)) {
            throw new Error('The active group could not be found.');
        }

        const header = {
            chat_metadata: metadata,
            user_name: 'unused',
            character_name: 'unused',
        };
        const request = await compressRequest({
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ id: branchName, chat: [header, ...snapshot] }),
        });
        const response = await fetch('/api/chats/group/save', request);
        if (!response.ok) {
            throw await this.responseError(response, 'The group branch could not be saved.');
        }

        const updatedGroup = structuredClone(group);
        updatedGroup.chats = [...group.chats, branchName];
        const groupResponse = await fetch('/api/groups/edit', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify(updatedGroup),
        });
        if (!groupResponse.ok) {
            throw await this.responseError(groupResponse, 'The group branch was saved but could not be added to the group registry.');
        }

        // Only after the registry save succeeds, mirror that normal registry
        // update in the live group object so openGroupChat can find the branch.
        group.chats.splice(0, group.chats.length, ...updatedGroup.chats);
    }

    /**
     * @param {Response} response
     * @param {string} fallback
     * @returns {Promise<Error>}
     */
    async responseError(response, fallback) {
        try {
            const data = await response.json();
            if (data?.error === 'integrity') {
                return new Error('The branch save failed its integrity check; the source chat was not changed.');
            }
            if (typeof data?.error === 'string') {
                return new Error(data.error);
            }
        } catch {
            // Some server errors have no JSON body.
        }

        return new Error(response.statusText || fallback);
    }

    /**
     * @param {'info'|'warning'|'error'} type
     * @param {string} message
     * @param {string} title
     */
    notify(type, message, title) {
        const toaster = globalThis.toastr;
        if (toaster && typeof toaster[type] === 'function') {
            toaster[type](message, title);
            return;
        }

        console[type === 'error' ? 'error' : 'warn'](`[${title}] ${message}`);
    }
}

const existingExtension = globalThis[EXTENSION_KEY];
if (existingExtension?.dispose) {
    existingExtension.dispose();
}

const extension = new SwipeArchiver();
globalThis[EXTENSION_KEY] = extension;
extension.initialize();
