'use strict';

const { buildMemberBanner, sortMemberBanners } = require('./member-banner-core');

function createMemberBannerEvents(options) {
  const config = options || {};
  const now = typeof config.now === 'function' ? config.now : Date.now;
  const emit = typeof config.emit === 'function' ? config.emit : function () {};
  const schedule = typeof config.schedule === 'function' ? config.schedule : function (callback, delay) {
    const timer = setTimeout(callback, delay);
    if (typeof timer.unref === 'function') timer.unref();
  };
  const betCooldownMs = config.betCooldownMs == null ? 8000 : config.betCooldownMs;
  const instanceId = String(config.instanceId || (process.pid.toString(36) + '_' + Date.now().toString(36)));
  const betCooldowns = new Map();
  let sequence = 0;

  function buildAt(roomId, player, type, detail, createdAt) {
    sequence += 1;
    return buildMemberBanner({
      roomId,
      player,
      type,
      detail: detail || {},
      eventId: 'mb_' + roomId + '_' + type + '_' + instanceId + '_' + sequence,
      createdAt
    });
  }

  function build(roomId, player, type, detail) {
    return buildAt(roomId, player, type, detail, now());
  }

  function buildBankerIfChanged(room, previousDealerId) {
    if (!room || previousDealerId === room.dealerOpenId) return null;
    const newDealer = (room.players || []).find(function (player) {
      return player.openId === room.dealerOpenId;
    });
    if (!newDealer) return null;
    return build(room.roomId, newDealer, 'banker');
  }

  function buildBetIfAllowed(roomId, player, amount) {
    if (!player || player.autoBet) return null;
    const createdAt = now();
    const cooldownKey = roomId + ':' + player.openId + ':bet';
    const previousAt = betCooldowns.get(cooldownKey);
    if (previousAt != null && createdAt - previousAt < betCooldownMs) return null;

    const event = buildAt(roomId, player, 'bet', { amount }, createdAt);
    if (event) {
      betCooldowns.set(cooldownKey, createdAt);
      schedule(function () {
        if (betCooldowns.get(cooldownKey) === createdAt) betCooldowns.delete(cooldownKey);
      }, betCooldownMs);
    }
    return event;
  }

  function sortBatch(events) {
    return sortMemberBanners(events);
  }

  function emitBatch(roomId, events) {
    const sorted = sortBatch(events);
    sorted.forEach(function (event) {
      emit(roomId, event);
    });
    return sorted;
  }

  return {
    build,
    buildBankerIfChanged,
    buildBetIfAllowed,
    sortBatch,
    emitBatch
  };
}

module.exports = { createMemberBannerEvents };
