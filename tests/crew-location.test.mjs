import assert from 'node:assert/strict';
import test from 'node:test';
import { crewLocationPage } from '../lib/crew-location-page.ts';

test('legacy crew-location links return to the on-site sharing panel without data lookup or external destination', async () => {
  const response = crewLocationPage();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/#live');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await response.text(), '');
});
