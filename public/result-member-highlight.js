(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResultMemberHighlight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function getResultMemberHighlightVariant(memberLevel, handType) {
    if (typeof memberLevel !== 'string' || !memberLevel.trim()) return null;
    if (handType === 4) return 'straight-flush';
    if (handType === 5) return 'three-of-a-kind';
    return null;
  }

  return { getResultMemberHighlightVariant: getResultMemberHighlightVariant };
});
