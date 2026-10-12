import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BATCH_ENTRY_MS, entranceOffset, clipStrokeToBounds } from '../motion.js';
import { ARENA, createRun, applyRunCut, strokeForPizza } from '../game.js';

const rules = JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8'));
const almost = (first, second) => assert.ok(Math.abs(first - second) < 1e-8, `${first} differs from ${second}`);

test('each batch starts fully left of the board and settles without overshooting or restarting', () => {
  const initial = entranceOffset(0);
  // The rightmost possible pizza is centred at 70 with a radius of 42.
  assert.ok(70 + 42 + initial < ARENA.left);
  assert.equal(entranceOffset(-1000), initial);
  let previous = initial;
  for (const elapsed of [50, 100, 150, 225, 300, 400, BATCH_ENTRY_MS]) {
    const offset = entranceOffset(elapsed);
    assert.ok(offset >= previous && offset <= 0);
    previous = offset;
  }
  assert.equal(entranceOffset(BATCH_ENTRY_MS), 0);
  assert.equal(entranceOffset(4500), 0);
  assert.equal(entranceOffset(60000), 0);
});

test('reduced motion places a batch at its destination immediately, including preparation', () => {
  for (const elapsed of [-3000, 0, 200, 450, 5000]) assert.equal(entranceOffset(elapsed, true), 0);
});

test('segment clipping preserves a diagonal angle when inverse-mapped endpoints exceed API limits', () => {
  const stroke = { start: { x: -350, y: -140 }, end: { x: 450, y: 180 } };
  const snapshot = structuredClone(stroke);
  const clipped = clipStrokeToBounds(stroke);
  assert.deepEqual(clipped, { start: { x: -200, y: -80 }, end: { x: 200, y: 80 } });
  almost(Math.atan2(clipped.end.y - clipped.start.y, clipped.end.x - clipped.start.x),
    Math.atan2(stroke.end.y - stroke.start.y, stroke.end.x - stroke.start.x));
  assert.deepEqual(stroke, snapshot);
  const reversed = clipStrokeToBounds({ start: stroke.end, end: stroke.start });
  assert.deepEqual(reversed, { start: clipped.end, end: clipped.start });
});

test('clipping ignores outside swipes and preserves harmless stationary or boundary-touching strokes', () => {
  for (const stroke of [
    { start: { x: 210, y: -50 }, end: { x: 240, y: 100 } },
    { start: { x: -250, y: 210 }, end: { x: 250, y: 210 } },
    { start: { x: 300, y: 300 }, end: { x: 300, y: 300 } }
  ]) assert.equal(clipStrokeToBounds(stroke), null);
  assert.deepEqual(clipStrokeToBounds({ start: { x: 12, y: 8 }, end: { x: 12, y: 8 } }),
    { start: { x: 12, y: 8 }, end: { x: 12, y: 8 } });
  assert.deepEqual(clipStrokeToBounds({ start: { x: -250, y: 150 }, end: { x: -150, y: 250 } }),
    { start: { x: -200, y: 200 }, end: { x: -200, y: 200 } });
});

test('a frozen translated/scaled frame maps visible strokes to the same accepted pizza cuts', () => {
  let serial = 0;
  for (const [sizeRoll, scale, offset] of [[0, 0.8, -85], [0.5, 1.6, -60], [0.99, 2.1, -45]]) {
    const run = createRun({ id: 'motion-run-' + serial, playerId: 'p', requestId: 's-' + serial, bestScore: 0 },
      rules, 1000, () => sizeRoll < 0.8 ? sizeRoll : 0.79, () => 'motion-' + (++serial));
    const original = structuredClone(run);
    const correct = strokeForPizza(run.pizzas[0], 37);
    // This is the affine math of the SVG batch group's screen matrix, not a browser mock.
    const toScreen = (point) => ({ x: 300 + (point.x + offset) * scale, y: 250 + point.y * scale });
    const toCanonical = (point) => ({ x: (point.x - 300) / scale - offset, y: (point.y - 250) / scale });
    const mapped = clipStrokeToBounds({ start: toCanonical(toScreen(correct.start)), end: toCanonical(toScreen(correct.end)) });
    const result = applyRunCut(run, { waveId: run.waveId, ...mapped }, run.startsAt + 100);
    assert.equal(result.cutAccepted, true);
    assert.equal(result.run.pizzasSpoiled, 0);
    almost(result.run.pizzas[0].anchorAngle, 37);
    assert.equal(result.run.endsAt, run.endsAt);
    assert.equal(result.run.waveEndsAt, run.waveEndsAt);
    assert.deepEqual(run, original);
  }
});

test('a long clipped diameter remains a correct cut instead of being skewed at the board edges', () => {
  let serial = 0;
  const run = createRun({ id: 'wide', playerId: 'p', requestId: 's', bestScore: 0 }, rules, 1000, () => 0, () => 'wide-' + (++serial));
  const first = applyRunCut(run, { waveId: run.waveId, ...strokeForPizza(run.pizzas[0], 25) }, run.startsAt + 100).run;
  const angle = 115 * Math.PI / 180;
  const stroke = clipStrokeToBounds({
    start: { x: -Math.cos(angle) * 600, y: -Math.sin(angle) * 600 },
    end: { x: Math.cos(angle) * 600, y: Math.sin(angle) * 600 }
  });
  assert.ok(stroke);
  const result = applyRunCut(first, { waveId: first.waveId, ...stroke }, run.startsAt + 200);
  assert.equal(result.cutAccepted, true);
  assert.equal(result.run.pizzasCompleted, 1);
  assert.equal(result.run.score, 10);
});

test('malformed motion inputs fail before an invalid stroke can be submitted', () => {
  for (const value of [NaN, Infinity, '20']) assert.throws(() => entranceOffset(value));
  for (const stroke of [null, {}, { start: { x: NaN, y: 0 }, end: { x: 1, y: 1 } },
    { start: { x: 0, y: 0 }, end: { x: '30', y: 1 } }]) assert.throws(() => clipStrokeToBounds(stroke));
  assert.throws(() => clipStrokeToBounds({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }, 0));
});
