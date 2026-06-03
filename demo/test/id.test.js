const { test } = require('node:test');
const assert = require('node:assert');
const { newId } = require('../src/id');

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('newId returns a valid UUID v4', () => {
  assert.match(newId(), UUID_V4);
});

test('newId returns a different value each call', () => {
  assert.notStrictEqual(newId(), newId());
});
