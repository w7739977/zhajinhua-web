'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemberBannerEvents } = require('../member-banner-events');

function vipPlayer(overrides) {
  return Object.assign({
    openId: 'vip-1',
    nickName: 'wxw',
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  }, overrides || {});
}

test('build creates core payload with deterministic event id and time', () => {
  const events = createMemberBannerEvents({ now: () => 1234, instanceId: 'test' });

  const event = events.build('628792', vipPlayer(), 'join');

  assert.equal(event.eventId, 'mb_628792_join_test_1');
  assert.equal(event.createdAt, 1234);
  assert.equal(event.type, 'join');
  assert.equal(event.message, '♛ VIP · wxw 尊耀降临，华丽入局');
});

test('different server instances generate distinct event IDs', () => {
  const first = createMemberBannerEvents({ now: () => 1, instanceId: 'server-a' });
  const second = createMemberBannerEvents({ now: () => 1, instanceId: 'server-b' });

  assert.notEqual(
    first.build('1', vipPlayer(), 'join').eventId,
    second.build('1', vipPlayer(), 'join').eventId
  );
});

test('build rejects players without the required privilege', () => {
  const events = createMemberBannerEvents({ now: () => 1 });
  assert.equal(events.build('1', vipPlayer({ privilegeFlags: [] }), 'join'), null);
});

test('buildBankerIfChanged targets only a newly changed eligible dealer', () => {
  const events = createMemberBannerEvents({ now: () => 10 });
  const newDealer = vipPlayer({ openId: 'vip-new' });
  const room = {
    roomId: '88',
    dealerOpenId: 'vip-new',
    players: [vipPlayer({ openId: 'old' }), newDealer]
  };

  assert.equal(events.buildBankerIfChanged(room, 'vip-new'), null);
  const event = events.buildBankerIfChanged(room, 'old');
  assert.equal(event.playerId, 'vip-new');
  assert.equal(event.type, 'banker');

  room.players[1] = Object.assign({}, newDealer, { privilegeFlags: [] });
  assert.equal(events.buildBankerIfChanged(room, 'old'), null);
});

test('bet cooldown is isolated by room and player and opens at 8000ms', () => {
  let currentTime = 1000;
  const events = createMemberBannerEvents({ now: () => currentTime });
  const firstPlayer = vipPlayer({ openId: 'vip-a' });
  const secondPlayer = vipPlayer({ openId: 'vip-b' });

  assert.equal(events.buildBetIfAllowed('room-a', firstPlayer, 1).amount, 1);
  currentTime = 8999;
  assert.equal(events.buildBetIfAllowed('room-a', firstPlayer, 2), null);
  assert.equal(events.buildBetIfAllowed('room-b', firstPlayer, 2).amount, 2);
  assert.equal(events.buildBetIfAllowed('room-a', secondPlayer, 3).amount, 3);
  currentTime = 9000;
  assert.equal(events.buildBetIfAllowed('room-a', firstPlayer, 2).amount, 2);
});

test('ineligible bet does not consume cooldown', () => {
  let currentTime = 5;
  const events = createMemberBannerEvents({ now: () => currentTime });
  const player = vipPlayer({ privilegeFlags: [] });

  assert.equal(events.buildBetIfAllowed('room-a', player, 1), null);
  player.privilegeFlags = ['banner:bet'];
  assert.equal(events.buildBetIfAllowed('room-a', player, 1).amount, 1);
});

test('bet cooldown entry is removed after its scheduled expiry', () => {
  const scheduled = [];
  const events = createMemberBannerEvents({
    now: () => 100,
    schedule: function (callback, delay) { scheduled.push({ callback, delay }); }
  });
  const player = vipPlayer();

  assert.equal(events.buildBetIfAllowed('room-a', player, 1).amount, 1);
  assert.equal(events.buildBetIfAllowed('room-a', player, 1), null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 8000);

  scheduled[0].callback();
  assert.equal(events.buildBetIfAllowed('room-a', player, 1).amount, 1);
});

test('sortBatch and emitBatch preserve priority and FIFO without mutating room', () => {
  const emitted = [];
  const events = createMemberBannerEvents({
    now: () => 20,
    emit: (roomId, event) => emitted.push({ roomId, event })
  });
  const player = vipPlayer();
  const room = { roomId: '9', dealerOpenId: player.openId, players: [player] };
  const before = JSON.parse(JSON.stringify(room));
  const batch = [
    events.build('9', player, 'bet', { amount: 1 }),
    events.build('9', player, 'join'),
    events.build('9', player, 'bet', { amount: 2 }),
    events.build('9', player, 'open_card', { openMode: 'openAll' }),
    events.build('9', player, 'banker')
  ];

  assert.deepEqual(events.sortBatch(batch).map(event => event.type), [
    'banker', 'open_card', 'join', 'bet', 'bet'
  ]);
  const sent = events.emitBatch('9', batch);
  assert.deepEqual(sent.map(event => event.type), [
    'banker', 'open_card', 'join', 'bet', 'bet'
  ]);
  assert.deepEqual(emitted.map(item => item.roomId), ['9', '9', '9', '9', '9']);
  assert.deepEqual(room, before);
});
