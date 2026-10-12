import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateRules, createRound, advanceRound, applyCut, toPublicRound,
  strokeForAngle, sortPlayersByBestTime, isRoundOver
} from '../game.js';

const rules = validateRules(JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8')));
function makeRound(sizeIndex = 0, rotationRandom = 0, overrides = {}) {
  const values = [(sizeIndex + 0.1) / 3, rotationRandom];
  return createRound(
    { id: 'round-one', playerId: 'player-one', requestId: 'start-one' },
    { ...rules, ...overrides }, 1000, () => values.shift()
  );
}

test('each random pizza uses the exact size, slice, and diameter-cut mapping', () => {
  const cases = [[14, 8, 4], [10, 6, 3], [8, 4, 2]];
  cases.forEach(([size, slices, cuts], index) => {
    const round = makeRound(index);
    assert.equal(round.pizzaSize, size);
    assert.equal(round.requiredSlices, slices);
    assert.equal(round.requiredCuts, cuts);
    assert.equal(round.guideAngles.length, cuts);
    assert.equal(toPublicRound(round, 1000).currentSlices, 1);
    assert.deepEqual(round.completedCuts, []);
  });
});

test('random rotation changes guide direction while keeping equal slice spacing', () => {
  const round = makeRound(0, 0.6);
  assert.deepEqual(round.guideAngles, [105, 150, 15, 60]);
  const sorted = [...round.guideAngles].sort((a, b) => a - b);
  sorted.forEach((angle, index) => {
    const next = sorted[(index + 1) % sorted.length];
    assert.equal((next - angle + 180) % 180, 45);
  });
});

test('preparation excludes early cuts and does not consume playing time', () => {
  const round = makeRound();
  const early = applyCut(round, strokeForAngle(0), round.startsAt - 1);
  assert.equal(early.round.status, 'countdown');
  assert.equal(early.cutAccepted, false);
  assert.deepEqual(early.round.completedCuts, []);
  const view = toPublicRound(early.round, round.startsAt - 1);
  assert.equal(view.countdownMs, 1);
  assert.equal(view.remainingMs, rules.roundDurationMs);
  const ready = advanceRound(round, round.startsAt);
  assert.equal(ready.status, 'playing');
  assert.equal(toPublicRound(ready, round.startsAt).remainingMs, rules.roundDurationMs);
  assert.equal(round.status, 'countdown');
});

test('all three sizes win only after every distinct required diameter cut', () => {
  for (let sizeIndex = 0; sizeIndex < 3; sizeIndex += 1) {
    const original = makeRound(sizeIndex);
    let round = original;
    original.guideAngles.forEach((angle, index) => {
      const result = applyCut(round, strokeForAngle(angle), original.startsAt + (index + 1) * 100);
      round = result.round;
      assert.equal(result.cutAccepted, true);
      assert.equal(toPublicRound(round, round.finishedAt ?? original.startsAt).currentSlices, (index + 1) * 2);
      assert.equal(round.status, index + 1 === original.requiredCuts ? 'won' : 'playing');
    });
    assert.equal(round.reason, 'correct_slices');
    assert.equal(round.elapsedMs, original.requiredCuts * 100);
    assert.equal(round.recorded, false);
    assert.deepEqual(original.completedCuts, []);
  }
});

test('the same diameter, including reverse direction, cannot score twice', () => {
  const original = makeRound();
  const stroke = strokeForAngle(0);
  const first = applyCut(original, stroke, original.startsAt + 100);
  const duplicate = applyCut(first.round, { start: stroke.end, end: stroke.start }, original.startsAt + 200);
  assert.equal(duplicate.cutAccepted, false);
  assert.strictEqual(duplicate.round, first.round);
  assert.deepEqual(duplicate.round.completedCuts, [0]);
  assert.match(duplicate.feedback, /already/);
});

test('a full cut at the wrong angle loses with an immutable outcome', () => {
  const original = makeRound();
  const result = applyCut(original, strokeForAngle(22.5), original.startsAt + 250);
  assert.equal(result.round.status, 'lost');
  assert.equal(result.round.reason, 'wrong_cut');
  assert.equal(result.round.elapsedMs, 250);
  assert.deepEqual(original.completedCuts, []);
  assert.equal(original.status, 'countdown');
  const retry = applyCut(result.round, strokeForAngle(0), original.startsAt + 300);
  assert.strictEqual(retry.round, result.round);
});

test('a full chord away from the centre loses even if its angle matches a guide', () => {
  const original = makeRound();
  const result = applyCut(original, { start: { x: -1, y: 0.3 }, end: { x: 1, y: 0.3 } }, original.startsAt + 100);
  assert.equal(result.round.status, 'lost');
  assert.equal(result.round.reason, 'wrong_cut');
});

test('short, incomplete, and outside swipes do not cut or lose the pizza', () => {
  const original = makeRound();
  const round = advanceRound(original, original.startsAt);
  for (const stroke of [
    { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    { start: { x: -1, y: 0 }, end: { x: -0.9, y: 0 } },
    { start: { x: -0.8, y: 1.4 }, end: { x: 0.8, y: 1.4 } },
    { start: { x: -2, y: 0 }, end: { x: 2, y: 0 } }
  ]) {
    const result = applyCut(round, stroke, original.startsAt + 500);
    assert.strictEqual(result.round, round);
    assert.equal(result.cutAccepted, false);
    assert.equal(result.round.status, 'playing');
  }
});

test('guide and centre tolerance accept realistic swipes at the inclusive boundary', () => {
  const original = makeRound();
  const angled = applyCut(original, strokeForAngle(10), original.startsAt + 100);
  assert.equal(angled.cutAccepted, true);
  const offset = applyCut(original, { start: { x: -1, y: 0.12 }, end: { x: 1, y: 0.12 } }, original.startsAt + 100);
  assert.equal(offset.cutAccepted, true);
  const tooFar = applyCut(original, strokeForAngle(10.01), original.startsAt + 100);
  assert.equal(tooFar.round.reason, 'wrong_cut');
});

test('deadline and delayed checks lose before processing a final cut', () => {
  const original = makeRound(2);
  const first = applyCut(original, strokeForAngle(original.guideAngles[0]), original.startsAt + 100).round;
  const expired = applyCut(first, strokeForAngle(original.guideAngles[1]), original.endsAt).round;
  assert.equal(expired.status, 'lost');
  assert.equal(expired.reason, 'timeout');
  assert.equal(expired.elapsedMs, rules.roundDurationMs);
  assert.equal(expired.finishedAt, original.endsAt);
  assert.equal(expired.completedCuts.length, 1);
  const delayed = advanceRound(original, original.endsAt + 60000);
  assert.equal(delayed.status, 'lost');
  assert.equal(delayed.elapsedMs, rules.roundDurationMs);
  assert.equal(toPublicRound(delayed, original.endsAt + 60000).remainingMs, 0);
});

test('a final cut just before the deadline wins and cannot later turn into a loss', () => {
  const original = makeRound(2);
  const first = applyCut(original, strokeForAngle(original.guideAngles[0]), original.startsAt + 100).round;
  const won = applyCut(first, strokeForAngle(original.guideAngles[1]), original.endsAt - 0.01).round;
  assert.equal(won.status, 'won');
  assert.equal(won.elapsedMs, rules.roundDurationMs - 1);
  assert.strictEqual(advanceRound(won, original.endsAt + 50000), won);
  assert.equal(toPublicRound(won, original.endsAt + 50000).remainingMs, 1);
});

test('a zero-duration finish is represented by a positive millisecond and immediate play is supported', () => {
  let round = makeRound(2, 0, { preparationMs: 0 });
  assert.equal(round.status, 'playing');
  for (const angle of round.guideAngles) round = applyCut(round, strokeForAngle(angle), round.startsAt).round;
  assert.equal(round.status, 'won');
  assert.equal(round.elapsedMs, 1);
});

test('public round data hides retry bookkeeping and protects stored arrays', () => {
  const round = makeRound();
  round.startRequestIds = ['private-request'];
  const view = toPublicRound(round, round.createdAt);
  assert.equal(view.requestId, undefined);
  assert.equal(view.recorded, undefined);
  assert.equal(view.cutRequestIds, undefined);
  assert.equal(view.startRequestIds, undefined);
  view.guideAngles.push(123);
  view.completedCuts.push(0);
  assert.equal(round.guideAngles.length, 4);
  assert.deepEqual(round.completedCuts, []);
});

test('leaderboards compare the selected size only, preserve unranked players, and keep input order intact', () => {
  const players = [
    { id: 'a', name: 'Ali', roundsWon: 5, roundsLost: 1, bestTimesBySize: { 8: 500, 10: null, 14: 8000 } },
    { id: 'b', name: 'Ben', roundsWon: 3, roundsLost: 0, bestTimesBySize: { 8: 900, 10: null, 14: 5000 } },
    { id: 'c', name: 'Cara', roundsWon: 0, roundsLost: 2, bestTimesBySize: { 8: null, 10: null, 14: null } },
    { id: 'd', name: 'Dan', roundsWon: 4, roundsLost: 1, bestTimesBySize: { 8: null, 10: null, 14: 5000 } }
  ];
  assert.deepEqual(sortPlayersByBestTime(players, 14).map(p => p.id), ['d', 'b', 'a', 'c']);
  assert.deepEqual(sortPlayersByBestTime(players, 8).map(p => p.id), ['a', 'b', 'd', 'c']);
  assert.deepEqual(players.map(p => p.id), ['a', 'b', 'c', 'd']);
  assert.throws(() => sortPlayersByBestTime(players, 12));
});

test('malformed game settings, identifiers, clocks, randomness, and coordinates are rejected', () => {
  for (const bad of [
    null, {}, { ...rules, roundDurationMs: 0 }, { ...rules, preparationMs: -1 },
    { ...rules, pizzas: [{ sizeInches: 16 }, ...rules.pizzas.slice(1)] },
    { ...rules, pizzas: [rules.pizzas[0], rules.pizzas[0], rules.pizzas[2]] },
    { ...rules, pizzas: [{ sizeInches: 14, slices: 6 }, ...rules.pizzas.slice(1)] }
  ]) assert.throws(() => validateRules(bad));
  assert.throws(() => createRound({ id: '', playerId: 'p', requestId: 'r' }, rules, 0));
  assert.throws(() => createRound({ id: 'r', playerId: 'p', requestId: 'q' }, rules, 0, () => 1));
  const round = makeRound();
  assert.throws(() => advanceRound(round, -1));
  assert.throws(() => applyCut(round, { start: { x: NaN, y: 0 }, end: { x: 1, y: 0 } }, round.startsAt));
  assert.throws(() => applyCut(round, { start: { x: -4, y: 0 }, end: { x: 1, y: 0 } }, round.startsAt));
  assert.throws(() => strokeForAngle(Infinity));
  assert.equal(isRoundOver(null), false);
});
