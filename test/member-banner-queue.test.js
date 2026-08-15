'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemberBannerQueue } = require('../public/member-banner-queue');

function banner(eventId, type, priority) {
  return { eventId, type, priority };
}

test('pending banners are priority ordered and FIFO for equal priority', () => {
  const queue = createMemberBannerQueue();
  queue.enqueue(banner('bet-1', 'bet', 10));
  queue.enqueue(banner('join', 'join', 20));
  queue.enqueue(banner('bet-2', 'bet', 10));
  queue.enqueue(banner('banker', 'banker', 40));
  queue.enqueue(banner('open', 'open_card', 30));

  assert.deepEqual(queue.pending().map(event => event.eventId), [
    'banker', 'open', 'join', 'bet-1', 'bet-2'
  ]);
});

test('active banner is never interrupted by higher priority arrivals', () => {
  const queue = createMemberBannerQueue();
  queue.enqueue(banner('bet', 'bet', 10));
  assert.equal(queue.takeNext().eventId, 'bet');

  queue.enqueue(banner('banker', 'banker', 40));
  assert.equal(queue.takeNext(), null);
  assert.equal(queue.active().eventId, 'bet');
  assert.equal(queue.finish('banker'), false);
  assert.equal(queue.finish('bet'), true);
  assert.equal(queue.takeNext().eventId, 'banker');
});

test('overflow removes the oldest pending bet first', () => {
  const queue = createMemberBannerQueue({ maxPending: 3 });
  queue.enqueue(banner('bet-old', 'bet', 10));
  queue.enqueue(banner('join', 'join', 20));
  queue.enqueue(banner('bet-new', 'bet', 10));
  queue.enqueue(banner('banker', 'banker', 40));

  assert.deepEqual(queue.pending().map(event => event.eventId), [
    'banker', 'join', 'bet-new'
  ]);
  assert.equal(queue.hasSeen('bet-old'), true);
  assert.equal(queue.enqueue(banner('bet-old', 'bet', 10)), false);
});

test('overflow without bets removes oldest event at the lowest priority', () => {
  const queue = createMemberBannerQueue({ maxPending: 3 });
  queue.enqueue(banner('join-old', 'join', 20));
  queue.enqueue(banner('banker', 'banker', 40));
  queue.enqueue(banner('join-new', 'join', 20));
  queue.enqueue(banner('open', 'open_card', 30));

  assert.deepEqual(queue.pending().map(event => event.eventId), [
    'banker', 'open', 'join-new'
  ]);
});

test('duplicate IDs are rejected while active, pending, completed, or capacity-evicted', () => {
  const queue = createMemberBannerQueue({ maxPending: 1 });
  queue.enqueue(banner('active', 'join', 20));
  queue.takeNext();
  assert.equal(queue.enqueue(banner('active', 'join', 20)), false);

  queue.enqueue(banner('pending', 'bet', 10));
  assert.equal(queue.enqueue(banner('pending', 'bet', 10)), false);
  queue.enqueue(banner('replacement', 'banker', 40));
  assert.equal(queue.enqueue(banner('pending', 'bet', 10)), false);

  queue.finish('active');
  assert.equal(queue.enqueue(banner('active', 'join', 20)), false);
});

test('seen history retains only the most recent 100 event IDs', () => {
  const queue = createMemberBannerQueue({ maxPending: 200, maxSeen: 100 });
  for (let i = 1; i <= 101; i++) {
    queue.enqueue(banner('event-' + i, 'join', 20));
  }

  assert.equal(queue.hasSeen('event-1'), false);
  assert.equal(queue.hasSeen('event-2'), true);
  assert.equal(queue.hasSeen('event-101'), true);
  assert.equal(queue.enqueue(banner('event-1', 'join', 20)), true);
});

test('clear removes active and pending work without reviving duplicate IDs', () => {
  const queue = createMemberBannerQueue();
  queue.enqueue(banner('active', 'join', 20));
  queue.takeNext();
  queue.enqueue(banner('pending', 'bet', 10));

  queue.clear();

  assert.equal(queue.active(), null);
  assert.deepEqual(queue.pending(), []);
  assert.equal(queue.enqueue(banner('active', 'join', 20)), false);
});
