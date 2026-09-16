import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildBranchName,
    chooseUniqueBranchName,
    createBranchSnapshot,
    createSwipeProjection,
    getCanonicalSwipeIndex,
    isPreviewEligible,
    prunePreviewStates,
} from '../core.js';

function makeMessage(overrides = {}) {
    return {
        name: 'Seraphina',
        is_user: false,
        is_system: false,
        mes: 'Swipe four',
        swipe_id: 3,
        swipes: ['Swipe one', 'Swipe two', 'Swipe three', 'Swipe four'],
        swipe_info: [
            { send_date: '1', extra: { marker: 'one' } },
            { send_date: '2', extra: { marker: 'two' } },
            { send_date: '3', extra: { marker: 'three' } },
            { send_date: '4', extra: { marker: 'four' } },
        ],
        extra: { marker: 'four' },
        ...overrides,
    };
}

function cloneOnlySync(_messageId, swipeId, target) {
    if (!Array.isArray(target.swipes) || typeof target.swipes[swipeId] !== 'string') {
        return false;
    }

    target.swipe_id = swipeId;
    target.mes = target.swipes[swipeId];
    target.extra = structuredClone(target.swipe_info?.[swipeId]?.extra ?? {});
    return true;
}

test('the Seraphina-style canonical swipe is eligible and projects without source mutation', () => {
    const source = makeMessage();
    const before = structuredClone(source);

    assert.equal(getCanonicalSwipeIndex(source), 3);
    assert.equal(isPreviewEligible(source), true);

    const preview = createSwipeProjection(source, 1, cloneOnlySync);
    assert.equal(preview?.mes, 'Swipe two');
    assert.equal(preview?.swipe_id, 1);
    assert.deepEqual(preview?.extra, { marker: 'two' });
    assert.deepEqual(source, before);
});

test('branch snapshots select the previewed swipe only in the isolated payload', () => {
    const first = { name: 'User', is_user: true, mes: 'Hello' };
    const target = makeMessage();
    const chat = [first, target, { name: 'User', is_user: true, mes: 'Later' }];
    const before = structuredClone(chat);

    const snapshot = createBranchSnapshot(chat, 1, 0, cloneOnlySync);
    assert.equal(snapshot?.length, 2);
    assert.equal(snapshot?.[1].mes, 'Swipe one');
    assert.equal(snapshot?.[1].swipe_id, 0);
    assert.deepEqual(chat, before);
});

test('independent message preview state is identity-based and stale data is pruned', () => {
    const first = makeMessage({ mes: 'A' });
    const second = makeMessage({ mes: 'B', swipe_id: 1 });
    const previews = new Map([
        [first, { previewIndex: 0, creatingBranch: false }],
        [second, { previewIndex: 2, creatingBranch: false }],
    ]);

    assert.equal(previews.get(first)?.previewIndex, 0);
    assert.equal(previews.get(second)?.previewIndex, 2);
    assert.equal(prunePreviewStates(previews, [second]), 1);
    assert.equal(previews.has(first), false);
    assert.equal(previews.has(second), true);
});

test('malformed or non-assistant swipe data fails closed', () => {
    assert.equal(isPreviewEligible(makeMessage({ swipes: ['valid', null] })), false);
    assert.equal(isPreviewEligible(makeMessage({ swipe_id: 9 })), false);
    assert.equal(isPreviewEligible(makeMessage({ is_user: true })), false);
    assert.equal(isPreviewEligible(makeMessage({ is_system: true })), false);
    assert.equal(createSwipeProjection(makeMessage({ swipes: ['valid', null] }), 0, cloneOnlySync), null);
});

test('branch names use SillyTavern-style suffixes without changing the source name', () => {
    assert.equal(buildBranchName('Seraphina - Branch #4', 2), 'Seraphina - Branch #2');
    assert.equal(chooseUniqueBranchName('Seraphina', ['Seraphina - Branch #1', 'Seraphina - Branch #2']), 'Seraphina - Branch #3');
});
