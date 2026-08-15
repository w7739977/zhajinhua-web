'use strict';

const DEFAULT_PRIVILEGE_FLAGS = [
  'banner:join',
  'banner:bet',
  'banner:banker',
  'banner:open_card'
];

const DEFAULT_MEMBER_PROFILES = {
  wxw: {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: DEFAULT_PRIVILEGE_FLAGS.slice()
  },
  '傻叼刘敏': {
    memberLevel: 'vip',
    bannerTheme: 'casino_spectacle',
    privilegeFlags: DEFAULT_PRIVILEGE_FLAGS.slice()
  }
};

function normalizeMemberProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  if (typeof profile.memberLevel !== 'string' || !profile.memberLevel.trim()) return null;
  if (typeof profile.bannerTheme !== 'string' || !profile.bannerTheme.trim()) return null;
  if (!Array.isArray(profile.privilegeFlags) || profile.privilegeFlags.some(flag => typeof flag !== 'string')) return null;
  return {
    memberLevel: profile.memberLevel.trim(),
    bannerTheme: profile.bannerTheme.trim(),
    privilegeFlags: profile.privilegeFlags.slice()
  };
}

function cloneProfiles(profiles) {
  const result = {};
  Object.keys(profiles || {}).forEach(name => {
    const normalized = normalizeMemberProfile(profiles[name]);
    if (normalized) result[name] = normalized;
  });
  return result;
}

function loadMemberProfiles(rawJson, warn) {
  const profiles = cloneProfiles(DEFAULT_MEMBER_PROFILES);
  if (rawJson == null || rawJson === '') return profiles;

  let overrides;
  try {
    overrides = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  } catch (err) {
    if (typeof warn === 'function') warn('MEMBER_PROFILES_JSON 解析失败: ' + err.message);
    return profiles;
  }

  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    if (typeof warn === 'function') warn('MEMBER_PROFILES_JSON 必须是对象');
    return profiles;
  }

  Object.keys(overrides).forEach(name => {
    if (overrides[name] === null) {
      delete profiles[name];
      return;
    }
    const override = overrides[name];
    const candidate = profiles[name] && override && typeof override === 'object' && !Array.isArray(override)
      ? Object.assign({}, profiles[name], override)
      : override;
    const normalized = normalizeMemberProfile(candidate);
    if (!normalized) {
      if (typeof warn === 'function') warn('忽略无效会员配置: ' + name);
      return;
    }
    profiles[name] = normalized;
  });
  return profiles;
}

function getMemberProfile(nickname, profiles) {
  const name = String(nickname || '').trim();
  const profile = (profiles || {})[name];
  return profile ? normalizeMemberProfile(profile) : null;
}

function applyMemberProfile(player, profiles) {
  player.memberLevel = null;
  player.bannerTheme = null;
  player.privilegeFlags = [];
  const profile = getMemberProfile(player.nickName, profiles);
  if (!profile) return player;
  player.memberLevel = profile.memberLevel;
  player.bannerTheme = profile.bannerTheme;
  player.privilegeFlags = profile.privilegeFlags.slice();
  return player;
}

function hasMemberPrivilege(player, eventType) {
  return !!(player && Array.isArray(player.privilegeFlags) &&
    player.privilegeFlags.includes('banner:' + eventType));
}

const BANNER_PRIORITIES = {
  banker: 40,
  open_card: 30,
  join: 20,
  bet: 10
};

function getBannerPriority(type) {
  return BANNER_PRIORITIES[type] || null;
}

function getBannerCopy(type, nickname, detail) {
  const prefix = '♛ VIP · ' + nickname + ' ';
  if (type === 'join') {
    return { message: prefix + '尊耀降临，华丽入局', subtitle: 'ROYAL MEMBER ARRIVAL' };
  }
  if (type === 'bet') {
    const amount = Number(detail && detail.amount);
    if (![1, 2, 3].includes(amount)) return null;
    return { message: prefix + '豪掷 ' + amount + ' 杯，气势压场', subtitle: 'GOLDEN WAGER' };
  }
  if (type === 'banker') {
    return { message: prefix + '王者加冕，执掌庄位', subtitle: 'THE CROWN IS CLAIMED' };
  }
  if (type === 'open_card') {
    const copyByMode = {
      selectPlayers: '御令翻牌，点将对决',
      openAll: '号令全开，决胜此局',
      openAllNoPass: '霸气全开，王座不让'
    };
    const openMode = detail && detail.openMode;
    if (!copyByMode[openMode]) return null;
    return { message: prefix + copyByMode[openMode], subtitle: 'ROYAL SHOWDOWN' };
  }
  return null;
}

function buildMemberBanner(input) {
  const data = input || {};
  const player = data.player;
  const priority = getBannerPriority(data.type);
  if (!priority || !player || !hasMemberPrivilege(player, data.type)) return null;
  if (!data.roomId || !data.eventId || !player.openId || !String(player.nickName || '').trim()) return null;
  if (!player.memberLevel || player.bannerTheme !== 'casino_spectacle') return null;

  const copy = getBannerCopy(data.type, String(player.nickName).trim(), data.detail || {});
  if (!copy) return null;
  return {
    eventId: data.eventId,
    roomId: String(data.roomId),
    type: data.type,
    priority,
    playerId: player.openId,
    nickname: String(player.nickName).trim(),
    memberLevel: player.memberLevel,
    bannerTheme: player.bannerTheme,
    privilegeFlags: player.privilegeFlags.slice(),
    amount: data.type === 'bet' ? Number(data.detail.amount) : null,
    openMode: data.type === 'open_card' ? data.detail.openMode : null,
    message: copy.message,
    subtitle: copy.subtitle,
    duration: 3000,
    createdAt: data.createdAt
  };
}

function sortMemberBanners(events) {
  return (events || []).filter(Boolean).map(function (event, index) {
    return { event, index };
  }).sort(function (a, b) {
    return (b.event.priority - a.event.priority) || (a.index - b.index);
  }).map(function (item) { return item.event; });
}

module.exports = {
  DEFAULT_MEMBER_PROFILES,
  normalizeMemberProfile,
  loadMemberProfiles,
  getMemberProfile,
  applyMemberProfile,
  hasMemberPrivilege,
  getBannerPriority,
  buildMemberBanner,
  sortMemberBanners
};
