import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../public/data/support-points.json', import.meta.url), 'utf8'));

test('original numbered meeting points 1–23 have readable map and meeting details', () => {
  for (let number = 1; number <= 23; number++) {
    const group = data.groups.find(group => group.number === number);
    assert(group, 'missing group ' + number);
    const originals = group.options.filter(point => point.kind === 'historic-support-option');
    assert(originals.length, 'missing original pin ' + number);
    for (const point of originals) {
      assert(point.town && group.town, 'missing town for point ' + number);
      assert.equal(point.town, group.town);
      assert(point.landmark?.mapLabel, 'missing map label for point ' + number);
      assert(point.landmark?.nearbyLabel, 'missing nearby context for point ' + number);
      assert(point.landmark?.meetingNote, 'missing meeting description for point ' + number);
      assert(point.landmark?.sources?.length, 'missing source for point ' + number);
      assert(Number.isFinite(point.lat) && Number.isFinite(point.lng), 'missing original coordinates for point ' + number);
    }
  }
});

test('the six newly described pins preserve the historic route instructions', () => {
  const historic = {
    18: 'Intersection on your left',
    19: 'Firework shop car park on your right',
    20: 'junction on your left',
    21: 'on your left',
    22: 'Road on your right',
    23: 'Road side'
  };
  for (const [number, detail] of Object.entries(historic)) {
    const group = data.groups.find(group => group.number === Number(number));
    const point = group.options.find(point => point.id === 'point-' + number);
    assert.equal(point.detail, detail);
    assert.equal(point.isOfficialCheckpoint, false);
    assert.match(point.landmark.meetingNote, /original Point|original Point/i);
    assert.match(point.landmark.meetingNote, /pin|stopping|parking|car park/i);
  }
});
