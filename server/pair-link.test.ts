import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFromScan } from '../src/pair-link.ts';

test('a pairing QR link yields the six-character code', () => {
  assert.equal(codeFromScan('http://127.0.0.1:5173/#pair=AG4-DRL'), 'AG4DRL');
  assert.equal(codeFromScan('http://192.168.6.86:5173/?pair=AG4-DRL'), 'AG4DRL');
  assert.equal(codeFromScan('ag4drl'), 'AG4DRL');
  assert.equal(codeFromScan('http://127.0.0.1:5173/'), null);
  assert.equal(codeFromScan('not-a-code'), null);
});
