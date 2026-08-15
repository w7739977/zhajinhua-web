'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MEMBER_PROFILES,
  normalizeMemberProfile,
  loadMemberProfiles,
  getMemberProfile,
  applyMemberProfile,
  hasMemberPrivilege,
  getBannerPriority,
  buildMemberBanner,
  sortMemberBanners
} = require('../member-banner-core');

test('default wxw profile is a casino spectacle VIP', () => {
  const profile = getMemberProfile('wxw', DEFAULT_MEMBER_PROFILES);

  assert.deepEqual(profile, {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  });
});

test('default Chinese nickname profile is configured', () => {
  assert.equal(getMemberProfile('傻叼刘敏', DEFAULT_MEMBER_PROFILES).memberLevel, 'vip');
});

test('nickname matching trims whitespace but remains case-sensitive', () => {
  assert.equal(getMemberProfile('  wxw  ', DEFAULT_MEMBER_PROFILES).memberLevel, 'vip');
  assert.equal(getMemberProfile('WXW', DEFAULT_MEMBER_PROFILES), null);
});

test('environment profiles override, add, and disable defaults', () => {
  const profiles = loadMemberProfiles(JSON.stringify({
    wxw: {
      memberLevel: 'svip',
      bannerTheme: 'casino_spectacle',
      privilegeFlags: ['banner:banker']
    },
    '新会员': {
      memberLevel: 'vip',
      bannerTheme: 'casino_spectacle',
      privilegeFlags: ['banner:join']
    },
    '傻叼刘敏': null
  }));

  assert.equal(profiles.wxw.memberLevel, 'svip');
  assert.equal(profiles['新会员'].privilegeFlags[0], 'banner:join');
  assert.equal(profiles['傻叼刘敏'], undefined);
});

test('partial default profile override shallow-merges inherited fields', () => {
  const profiles = loadMemberProfiles(JSON.stringify({
    wxw: { memberLevel: 'svip' }
  }));

  assert.deepEqual(profiles.wxw, {
    memberLevel: 'svip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: [
      'banner:join',
      'banner:bet',
      'banner:banker',
      'banner:open_card'
    ]
  });
});

test('invalid environment JSON warns and keeps defaults', () => {
  const warnings = [];
  const profiles = loadMemberProfiles('{bad json', function (message) { warnings.push(message); });

  assert.equal(profiles.wxw.memberLevel, 'vip');
  assert.equal(warnings.length, 1);
});

test('invalid profile fields are rejected', () => {
  assert.equal(normalizeMemberProfile({ memberLevel: 1, bannerTheme: 'x', privilegeFlags: [] }), null);
  assert.equal(normalizeMemberProfile({ memberLevel: 'vip', bannerTheme: 'x', privilegeFlags: [1] }), null);
});

test('applyMemberProfile clears stale membership when nickname changes', () => {
  const player = {
    nickName: '普通玩家',
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: ['banner:join'],
    score: 4
  };

  applyMemberProfile(player, DEFAULT_MEMBER_PROFILES);

  assert.deepEqual({
    memberLevel: player.memberLevel,
    bannerTheme: player.bannerTheme,
    privilegeFlags: player.privilegeFlags,
    score: player.score
  }, {
    memberLevel: null,
    bannerTheme: null,
    privilegeFlags: [],
    score: 4
  });
});

test('hasMemberPrivilege maps event type to banner flag', () => {
  const player = { privilegeFlags: ['banner:bet'] };
  assert.equal(hasMemberPrivilege(player, 'bet'), true);
  assert.equal(hasMemberPrivilege(player, 'join'), false);
});

test('banner priorities rank banker above open, join, and bet', () => {
  assert.deepEqual([
    getBannerPriority('banker'),
    getBannerPriority('open_card'),
    getBannerPriority('join'),
    getBannerPriority('bet')
  ], [40, 30, 20, 10]);
});

test('buildMemberBanner creates a complete bet payload', () => {
  const player = {
    openId: 'p_vip',
    nickName: 'wxw',
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: ['banner:bet']
  };

  const event = buildMemberBanner({
    roomId: '628792',
    player,
    type: 'bet',
    detail: { amount: 3 },
    eventId: 'mb_1',
    createdAt: 1234
  });

  assert.deepEqual(event, {
    eventId: 'mb_1',
    roomId: '628792',
    type: 'bet',
    priority: 10,
    playerId: 'p_vip',
    nickname: 'wxw',
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: ['banner:bet'],
    amount: 3,
    openMode: null,
    message: '♛ VIP · wxw 豪掷 3 杯，气势压场',
    subtitle: 'GOLDEN WAGER',
    duration: 3000,
    createdAt: 1234
  });
});

test('open card modes use distinct royal copy', () => {
  const player = {
    openId: 'p_vip', nickName: 'wxw', memberLevel: 'vip',
    bannerTheme: 'casino_spectacle', privilegeFlags: ['banner:open_card']
  };
  const messages = ['selectPlayers', 'openAll', 'openAllNoPass'].map(function (openMode, index) {
    return buildMemberBanner({
      roomId: '1', player, type: 'open_card', detail: { openMode },
      eventId: 'mb_' + index, createdAt: index
    }).message;
  });

  assert.deepEqual(messages, [
    '♛ VIP · wxw 御令翻牌，点将对决',
    '♛ VIP · wxw 号令全开，决胜此局',
    '♛ VIP · wxw 霸气全开，王座不让'
  ]);
});

test('buildMemberBanner rejects missing privileges and invalid open modes', () => {
  const player = {
    openId: 'p_vip', nickName: 'wxw', memberLevel: 'vip',
    bannerTheme: 'casino_spectacle', privilegeFlags: []
  };
  assert.equal(buildMemberBanner({ roomId: '1', player, type: 'join', eventId: 'x', createdAt: 1 }), null);
  player.privilegeFlags = ['banner:open_card'];
  assert.equal(buildMemberBanner({
    roomId: '1', player, type: 'open_card', detail: { openMode: 'bad' }, eventId: 'x', createdAt: 1
  }), null);
});

test('sortMemberBanners is priority ordered and stable', () => {
  const events = [
    { type: 'bet', priority: 10, marker: 'bet-1' },
    { type: 'join', priority: 20, marker: 'join' },
    { type: 'banker', priority: 40, marker: 'banker' },
    { type: 'bet', priority: 10, marker: 'bet-2' },
    { type: 'open_card', priority: 30, marker: 'open' }
  ];

  assert.deepEqual(sortMemberBanners(events).map(event => event.marker), [
    'banker', 'open', 'join', 'bet-1', 'bet-2'
  ]);
});
