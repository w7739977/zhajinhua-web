'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getResultMemberHighlightVariant
} = require('../public/result-member-highlight');

test('member straight flush uses the straight-flush highlight', () => {
  assert.equal(getResultMemberHighlightVariant('vip', 4), 'straight-flush');
});

test('member three of a kind uses the three-of-a-kind highlight', () => {
  assert.equal(getResultMemberHighlightVariant('vip', 5), 'three-of-a-kind');
});

test('all non-empty member levels are eligible', () => {
  assert.equal(getResultMemberHighlightVariant('svip', 4), 'straight-flush');
  assert.equal(getResultMemberHighlightVariant(' royal ', 5), 'three-of-a-kind');
});

test('non-members never receive a result highlight', () => {
  assert.equal(getResultMemberHighlightVariant(null, 4), null);
  assert.equal(getResultMemberHighlightVariant('', 5), null);
  assert.equal(getResultMemberHighlightVariant('   ', 4), null);
});

test('other and invalid hand types never receive a result highlight', () => {
  assert.equal(getResultMemberHighlightVariant('vip', 3), null);
  assert.equal(getResultMemberHighlightVariant('vip', '4'), null);
  assert.equal(getResultMemberHighlightVariant('vip'), null);
});
