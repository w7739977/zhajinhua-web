(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MemberBannerQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createMemberBannerQueue(options) {
    var config = options || {};
    var maxPending = config.maxPending == null ? 8 : config.maxPending;
    var maxSeen = config.maxSeen == null ? 100 : config.maxSeen;
    var pendingItems = [];
    var activeItem = null;
    var seenIds = new Map();
    var sequence = 0;

    function remember(eventId) {
      seenIds.set(eventId, true);
      while (seenIds.size > maxSeen) {
        seenIds.delete(seenIds.keys().next().value);
      }
    }

    function sortPending() {
      pendingItems.sort(function (a, b) {
        return (b.event.priority - a.event.priority) || (a.sequence - b.sequence);
      });
    }

    function trimOverflow() {
      while (pendingItems.length > maxPending) {
        var dropIndex = -1;
        var oldestSequence = Infinity;
        pendingItems.forEach(function (item, index) {
          if (item.event.type === 'bet' && item.sequence < oldestSequence) {
            dropIndex = index;
            oldestSequence = item.sequence;
          }
        });

        if (dropIndex === -1) {
          var lowestPriority = Math.min.apply(null, pendingItems.map(function (item) {
            return item.event.priority;
          }));
          pendingItems.forEach(function (item, index) {
            if (item.event.priority === lowestPriority && item.sequence < oldestSequence) {
              dropIndex = index;
              oldestSequence = item.sequence;
            }
          });
        }
        pendingItems.splice(dropIndex, 1);
      }
    }

    function enqueue(event) {
      if (!event || !event.eventId || seenIds.has(event.eventId)) return false;
      remember(event.eventId);
      sequence += 1;
      pendingItems.push({ event: event, sequence: sequence });
      sortPending();
      trimOverflow();
      return true;
    }

    function takeNext() {
      if (activeItem || pendingItems.length === 0) return null;
      activeItem = pendingItems.shift();
      return activeItem.event;
    }

    function finish(eventId) {
      if (!activeItem || activeItem.event.eventId !== eventId) return false;
      activeItem = null;
      return true;
    }

    function clear() {
      pendingItems = [];
      activeItem = null;
    }

    function pending() {
      return pendingItems.map(function (item) { return item.event; });
    }

    function active() {
      return activeItem ? activeItem.event : null;
    }

    function hasSeen(eventId) {
      return seenIds.has(eventId);
    }

    return {
      enqueue: enqueue,
      takeNext: takeNext,
      finish: finish,
      clear: clear,
      pending: pending,
      active: active,
      hasSeen: hasSeen
    };
  }

  return { createMemberBannerQueue: createMemberBannerQueue };
});
