import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateRules, createRun, advanceRun, applyRunCut, toPublicRun, strokeForPizza,
  strokeForAngle, normaliseAngle, isRunOver, SCORE_RULES, DIFFICULTY_LEVELS,
  PIZZA_SLICES, ARENA, ANGLE_TOLERANCE_DEG, CENTRE_TOLERANCE, GRENADE_DURATION_MS
} from '../game.js';

const rules = validateRules(JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8')));
let serial = 0;
const nextId = () => 'object-' + (++serial);
const draws = (...values) => () => values.shift() ?? 0;
function makeRun({ size = 0, grenade = 0, grenadeAngle = 0, bestScore = 0,
  preparationMs = rules.preparationMs } = {}) {
  return createRun({ id: 'run-' + (++serial), playerId: 'player-one', requestId: 'start-' + serial, bestScore },
    { ...rules, preparationMs }, 1000, draws(size, grenade, grenadeAngle), nextId);
}
function advance(run, nowMs, random = () => 0) { return advanceRun(run, nowMs, random, nextId); }
function gesture(run, stroke, nowMs = run.waveStartsAt + 1900, random = () => 0) {
  return applyRunCut(run, { waveId: run.waveId, ...stroke }, nowMs, random, nextId);
}
function cut(run, angle, nowMs = run.waveStartsAt + 1900, pizzaId = run.pizzas[0].id) {
  return gesture(run, strokeForPizza(run.pizzas.find((pizza) => pizza.id === pizzaId), angle), nowMs);
}
function complete(run, pizzaId = run.pizzas[0].id, nowMs = run.waveStartsAt + 1900, angle = 17.25) {
  const pizza = run.pizzas.find((value) => value.id === pizzaId);
  const anchor = pizza.anchorAngle ?? angle;
  for (let index = 0; index < pizza.requiredCuts; index += 1) {
    if (!pizza.completedCuts.includes(index)) run = cut(run, anchor + index * (180 / pizza.requiredCuts), nowMs, pizzaId).run;
  }
  return run;
}
function lastWave(bestScore = 0) {
  let run = makeRun({ bestScore });
  while (run.waveIndex < 11) {
    for (const pizza of [...run.pizzas]) run = complete(run, pizza.id);
    run = advance(run, run.waveEndsAt);
  }
  return run;
}
const across = (y = 0) => ({ start: { x: -145, y }, end: { x: 145, y } });

// These tests exercise shared game behavior. HTTP persistence and recovery are tested separately.
test('random sizes have the exact 10/12/14-inch mapping and proportional circumferences', () => {
  for (const [roll, size, slices, radius] of [[0, 10, 4, 30], [0.5, 12, 6, 36], [0.999, 14, 8, 42]]) {
    const run = makeRun({ size: roll });
    const pizza = run.pizzas[0];
    assert.equal(pizza.pizzaSize, size);
    assert.equal(pizza.requiredSlices, slices);
    assert.equal(pizza.requiredCuts, slices / 2);
    assert.equal(pizza.radius, radius);
    assert.equal(pizza.radius / size, 3);
    assert.equal(pizza.anchorAngle, null);
    assert.deepEqual(pizza.completedCuts, []);
    assert.equal(toPublicRun(run, run.createdAt).pizzas[0].currentSlices, 1);
    assert.equal(pizza.grenade, null);
  }
  assert.deepEqual(PIZZA_SLICES, { 10: 4, 12: 6, 14: 8 });
});

test('the first cut chooses any orientation and public state exposes no future guide angles', () => {
  for (const angle of [0, 17.25, 73, 179.9, -5, 360]) {
    const original = makeRun({ size: 0.99 });
    const result = cut(original, angle);
    const pizza = result.run.pizzas[0];
    assert.equal(result.cutAccepted, true);
    assert.ok(Math.abs(pizza.anchorAngle - normaliseAngle(angle)) < 1e-9);
    assert.deepEqual(pizza.completedCuts, [0]);
    const view = toPublicRun(result.run, original.startsAt + 1900).pizzas[0];
    assert.equal(view.cutAngles.length, 1);
    assert.equal(view.currentSlices, 2);
    for (const key of ['guideAngles', 'anchorAngle', 'completedCuts', 'rotation', 'angleToleranceDeg']) {
      assert.equal(Object.hasOwn(view, key), false);
    }
    assert.equal(original.pizzas[0].anchorAngle, null);
  }
});

test('equally spaced distinct cuts complete each size once and leave the board clear until the next batch', () => {
  for (const size of [0, 0.5, 0.9]) {
    const original = makeRun({ size });
    const pizza = original.pizzas[0];
    const run = complete(original);
    assert.equal(run.score, 10);
    assert.equal(run.pizzasCompleted, 1);
    assert.equal(run.pizzaCountsBySize[pizza.pizzaSize], 1);
    assert.deepEqual(run.pizzas, []);
    assert.equal(run.lastEvents[0].outcome, 'completed');
    assert.equal(run.lastEvents[0].pizza.completedCuts.length, pizza.requiredCuts);
    assert.equal(run.eventSerial, 1);
    assert.equal(run.endsAt, original.endsAt);
    assert.equal(run.status, 'playing');
    assert.strictEqual(advance(run, run.waveEndsAt - 1), run);
    const next = advance(run, run.waveEndsAt);
    assert.equal(next.pizzas.length, 1);
    assert.notEqual(next.waveId, run.waveId);
    assert.equal(next.pizzasMissed, 0);
    assert.deepEqual(next.lastEvents, run.lastEvents);
  }
});

test('accepted diameters retain their acceptance order and equal spacing around the first cut', () => {
  let run = makeRun({ size: 0.9 });
  for (const angle of [170, 80, 35, 125]) run = cut(run, angle).run;
  const pizza = toPublicRun(run, run.waveStartsAt + 1900).lastEvents[0].pizza;
  assert.deepEqual(pizza.cutAngles, [170, 80, 35, 125]);
  assert.equal(pizza.currentSlices, 8);
  const sorted = [...pizza.cutAngles].sort((a, b) => a - b);
  sorted.forEach((angle, index) => assert.equal((sorted[(index + 1) % sorted.length] - angle + 180) % 180, 45));
});

test('repeated and reversed diameters never count or penalize twice', () => {
  const run = cut(makeRun(), 17.25).run;
  const stroke = strokeForPizza(run.pizzas[0], 17.25);
  const duplicate = gesture(run, { start: stroke.end, end: stroke.start });
  assert.strictEqual(duplicate.run, run);
  assert.equal(duplicate.cutAccepted, false);
  assert.match(duplicate.feedback, /already/);
  assert.deepEqual(run.pizzas[0].completedCuts, [0]);
  assert.equal(run.eventSerial, 0);
});

test('stationary, incomplete, short, and outside strokes are harmless', () => {
  const original = makeRun();
  const run = advance(original, original.startsAt);
  for (const stroke of [
    { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
    { start: { x: -30, y: 0 }, end: { x: -27, y: 0 } },
    { start: { x: -23.99, y: 0 }, end: { x: 30, y: 0 } },
    { start: { x: -40, y: 30 }, end: { x: 40, y: 30 } },
    { start: { x: 60, y: 0 }, end: { x: 150, y: 0 } },
    { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  ]) {
    const result = gesture(run, stroke);
    assert.strictEqual(result.run, run);
    assert.equal(result.cutAccepted, false);
    assert.equal(result.run.pizzasSpoiled, 0);
  }
  assert.equal(gesture(run, { start: { x: -24, y: 0 }, end: { x: 24, y: 0 } }).cutAccepted, true);
});

test('full off-centre chords spoil a pizza and the centre tolerance is inclusive for every size', () => {
  for (const size of [0, 0.5, 0.9]) {
    const run = makeRun({ size });
    const tolerance = run.pizzas[0].radius * CENTRE_TOLERANCE;
    assert.equal(gesture(run, across(tolerance)).cutAccepted, true);
    const wrong = gesture(run, across(tolerance + 0.001));
    assert.equal(wrong.cutAccepted, false);
    assert.equal(wrong.run.pizzasSpoiled, 1);
    assert.equal(wrong.run.lastEvents[0].outcome, 'spoiled');
    assert.deepEqual(wrong.run.pizzas, []);
  }
});

test('subsequent cuts allow ten degrees of tolerance and spoil just outside it', () => {
  for (const size of [0, 0.5, 0.9]) {
    const run = cut(makeRun({ size }), 0).run;
    const next = 180 / run.pizzas[0].requiredCuts;
    assert.equal(cut(run, next + ANGLE_TOLERANCE_DEG).cutAccepted, true);
    assert.equal(cut(run, next - ANGLE_TOLERANCE_DEG).cutAccepted, true);
    assert.equal(cut(run, next + ANGLE_TOLERANCE_DEG + 0.001).run.pizzasSpoiled, 1);
  }
});

test('wrong-cut penalties remove only that pizza, floor at zero, and never end the minute early', () => {
  const earned = complete(makeRun());
  let run = earned;
  for (const expected of [5, 0, 0]) {
    run = advance(run, run.waveEndsAt);
    const result = gesture(run, across(9));
    run = result.run;
    assert.equal(run.score, expected);
    assert.equal(run.status, 'playing');
    assert.equal(run.endsAt, earned.endsAt);
    assert.deepEqual(run.pizzas, []);
  }
  assert.equal(run.pizzasSpoiled, 3);
  assert.equal(run.pizzasCompleted, 1);
  assert.equal(run.pizzasMissed, 0);
  assert.equal(earned.score, 10);
});

test('three seconds of preparation precede the full minute and accept no cuts or grenade hits', () => {
  const run = makeRun({ grenade: 0.99 });
  const early = cut(run, 0, run.startsAt - 1);
  assert.equal(early.run.status, 'countdown');
  assert.equal(early.cutAccepted, false);
  assert.equal(early.run.grenadesHit, 0);
  assert.deepEqual(early.run.pizzas[0].completedCuts, []);
  const view = toPublicRun(early.run, run.startsAt - 1);
  assert.equal(view.countdownMs, 1);
  assert.equal(view.remainingMs, 60000);
  const playing = advance(run, run.startsAt);
  assert.equal(playing.status, 'playing');
  assert.equal(playing.waveEndsAt, run.startsAt + 5000);
  assert.equal(toPublicRun(playing, run.startsAt).remainingMs, 60000);
  assert.equal(run.status, 'countdown');
});

test('twelve fixed batches offer 24 pizzas, with level changes exactly at 20 and 40 seconds', () => {
  let run = makeRun();
  let offered = 0;
  for (let index = 0; index < 12; index += 1) {
    const level = Math.floor(index / 4) + 1;
    assert.equal(run.waveIndex, index);
    assert.equal(run.difficultyLevel, level);
    assert.equal(run.pizzas.length, level);
    assert.equal(run.waveStartsAt, run.startsAt + index * 5000);
    assert.equal(run.waveEndsAt, run.startsAt + (index + 1) * 5000);
    assert.equal(advance(run, run.waveEndsAt - 1).waveId, run.waveId);
    offered += run.pizzas.length;
    run = advance(run, run.waveEndsAt);
  }
  assert.equal(offered, 24);
  assert.equal(run.pizzasMissed, 24);
  assert.equal(run.eventSerial, 24);
  assert.equal(run.waveIndex, 11);
  assert.equal(run.waveEndsAt, run.endsAt);
  assert.deepEqual(run.pizzas, []);
  assert.equal(run.status, 'lost');
});

test('batch layouts fit every size, remain distinct, and do not shift when a target is removed', () => {
  const original = makeRun();
  const run = advance(original, original.startsAt + 40000, () => 0.79);
  assert.deepEqual(run.pizzas.map(({ x, y }) => ({ x, y })), [{ x: -70, y: -50 }, { x: 70, y: -50 }, { x: 0, y: 65 }]);
  for (const pizza of run.pizzas) {
    assert.equal(pizza.pizzaSize, 14);
    assert.ok(pizza.x - pizza.radius >= ARENA.left && pizza.x + pizza.radius <= ARENA.right);
    assert.ok(pizza.y - pizza.radius >= ARENA.top && pizza.y + pizza.radius <= ARENA.bottom);
  }
  const remaining = complete(run, run.pizzas[1].id);
  assert.deepEqual(remaining.pizzas.map((pizza) => pizza.id), [run.pizzas[0].id, run.pizzas[2].id]);
  assert.deepEqual(remaining.pizzas.map(({ x, y }) => ({ x, y })), [{ x: -70, y: -50 }, { x: 0, y: 65 }]);
});

test('each pizza size is independently random and quantity is the only changing difficulty parameter', () => {
  const original = makeRun();
  const before = advance(original, original.startsAt + 39999);
  const run = advance(before, original.startsAt + 40000, draws(0, 0.79, 0.5, 0.79, 0.99, 0.79));
  assert.deepEqual(run.pizzas.map((pizza) => pizza.pizzaSize), [10, 12, 14]);
  assert.ok(run.pizzas.every((pizza) => pizza.grenade === null));
  assert.deepEqual(DIFFICULTY_LEVELS, [
    { level: 1, startsAfterMs: 0, pizzasPerWave: 1 },
    { level: 2, startsAfterMs: 20000, pizzasPerWave: 2 },
    { level: 3, startsAfterMs: 40000, pizzasPerWave: 3 }
  ]);
  for (const pizza of run.pizzas) {
    const first = cut(run, 0, run.waveStartsAt + 1900, pizza.id).run;
    assert.equal(cut(first, 180 / pizza.requiredCuts + 10, run.waveStartsAt + 1900, pizza.id).cutAccepted, true);
  }
});

test('a single long world-space swipe can complete two pizzas and score each once', () => {
  const original = makeRun();
  let run = advance(original, original.startsAt + 20000);
  for (const pizza of [...run.pizzas]) run = cut(run, 90, run.waveStartsAt + 1900, pizza.id).run;
  const result = gesture(run, across());
  assert.equal(result.cutAccepted, true);
  assert.equal(result.run.score, 20);
  assert.equal(result.run.pizzasCompleted, 2);
  assert.deepEqual(result.run.pizzas, []);
  assert.deepEqual(result.run.lastEvents.map((event) => event.outcome), ['completed', 'completed']);
  assert.equal(new Set(result.run.lastEvents.map((event) => event.id)).size, 2);
  assert.equal(gesture(result.run, across()).run.score, 20);
});

test('a swipe across two of three pizzas leaves the third untouched', () => {
  const original = makeRun();
  const run = advance(original, original.startsAt + 40000);
  const result = gesture(run, across(-50));
  assert.equal(result.cutAccepted, true);
  assert.deepEqual(result.run.pizzas.map((pizza) => pizza.completedCuts), [[0], [0], []]);
  assert.equal(result.run.pizzas[2], run.pizzas[2]);
  assert.equal(result.run.eventSerial, run.eventSerial);
});

test('mixed multi-pizza outcomes apply score floors in stable target order', () => {
  for (const [angles, expected] of [[[90, 30], 5], [[30, 90], 10]]) {
    const original = makeRun();
    let run = advance(original, original.startsAt + 20000);
    run.pizzas.forEach((pizza, index) => { run = cut(run, angles[index], run.waveStartsAt + 1900, pizza.id).run; });
    const result = gesture(run, across());
    assert.equal(result.run.score, expected);
    assert.equal(result.run.pizzasCompleted, 1);
    assert.equal(result.run.pizzasSpoiled, 1);
    assert.equal(result.run.pizzas.length, 0);
  }
});

test('unfinished pizzas expire individually at the exact batch deadline without immediate replacement', () => {
  let run = makeRun();
  for (let index = 0; index < 4; index += 1) { run = complete(run); run = advance(run, run.waveEndsAt); }
  assert.equal(run.score, 40);
  assert.equal(run.pizzas.length, 2);
  run = cut(run, 0).run;
  const before = advance(run, run.waveEndsAt - 0.01);
  assert.equal(before.score, 40);
  const expired = advance(run, run.waveEndsAt);
  assert.equal(expired.score, 30);
  assert.equal(expired.pizzasMissed, 2);
  assert.equal(expired.pizzasSpoiled, 0);
  assert.deepEqual(expired.lastEvents.map((event) => event.outcome), ['missed', 'missed']);
  assert.equal(expired.waveStartsAt, run.waveEndsAt);
  assert.notEqual(expired.waveId, run.waveId);
});

test('a stale wave ID cannot cut or hit hazards in a newly scheduled batch', () => {
  const run = makeRun();
  const result = gesture(run, across(), run.waveEndsAt, draws(0, 0.99, 0));
  assert.equal(result.cutAccepted, false);
  assert.equal(result.run.pizzasMissed, 1);
  assert.equal(result.run.grenadesHit, 0);
  assert.ok(result.run.pizzas[0].grenade);
  assert.deepEqual(result.run.pizzas[0].completedCuts, []);
  assert.match(result.feedback, /earlier swipe/);
});

test('grenades use each pizza’s true world coordinates and keep the same chance and duration at every level', () => {
  for (const elapsed of [0, 20000, 40000]) {
    let run = makeRun({ grenade: 0.8 });
    if (elapsed) run = advance(run, run.startsAt + elapsed, () => 0.8);
    for (const pizza of run.pizzas) {
      const hazard = pizza.grenade;
      assert.ok(hazard);
      assert.ok(Math.abs(Math.hypot(hazard.x - pizza.x, hazard.y - pizza.y) - pizza.radius * 0.65) < 1e-9);
      assert.equal(hazard.radius, pizza.radius * 0.20);
      assert.equal(hazard.appearsAt, run.waveStartsAt);
      assert.equal(hazard.disappearsAt, run.waveStartsAt + GRENADE_DURATION_MS);
    }
  }
  assert.equal(makeRun({ grenade: 0.799999 }).pizzas[0].grenade, null);
});

test('grenade collision checks the real segment, including short swipes and tangents', () => {
  const run = makeRun({ grenade: 0.99 });
  const hazard = run.pizzas[0].grenade;
  const at = run.startsAt + 100;
  for (const stroke of [
    { start: { x: hazard.x - 5, y: 0 }, end: { x: hazard.x + 5, y: 0 } },
    { start: { x: hazard.x - 5, y: hazard.radius }, end: { x: hazard.x + 5, y: hazard.radius } },
    { start: { x: hazard.x - 1.5, y: 0 }, end: { x: hazard.x + 1.5, y: 0 } }
  ]) {
    const result = gesture(run, stroke, at);
    assert.equal(result.run.grenadesHit, 1);
    assert.equal(result.run.pizzasSpoiled, 0);
    assert.equal(result.run.score, 0);
    assert.equal(result.run.pizzas.length, 0);
  }
  for (const stroke of [
    { start: { x: hazard.x - 5, y: hazard.radius + 0.01 }, end: { x: hazard.x + 5, y: hazard.radius + 0.01 } },
    { start: { x: hazard.x - 1, y: 0 }, end: { x: hazard.x + 1, y: 0 } },
    { start: { x: hazard.x, y: 0 }, end: { x: hazard.x, y: 0 } },
    { start: { x: -30, y: 0 }, end: { x: -20, y: 0 } }
  ]) assert.equal(gesture(run, stroke, at).run.grenadesHit, 0);
});

test('grenades deduct ten with no extra wrong-cut or later missed-pizza penalty', () => {
  let run = makeRun();
  for (let index = 0; index < 2; index += 1) {
    run = complete(run);
    run = advance(run, run.waveEndsAt, index === 1 ? draws(0, 0.99, 0) : () => 0);
  }
  assert.equal(run.score, 20);
  const result = gesture(run, across(), run.waveStartsAt + 100);
  assert.equal(result.run.score, 10);
  assert.equal(result.run.grenadesHit, 1);
  assert.equal(result.run.pizzasSpoiled, 0);
  assert.equal(result.run.lastEvents[0].outcome, 'grenade');
  assert.equal(result.run.status, 'playing');
  assert.equal(advance(result.run, result.run.waveEndsAt).pizzasMissed, 0);
});

test('grenades activate at wave start, stop at exact expiry, and take precedence over duplicate cuts', () => {
  const run = makeRun({ grenade: 0.99 });
  const hazard = run.pizzas[0].grenade;
  assert.equal(cut(run, 0, hazard.appearsAt).run.grenadesHit, 1);
  assert.equal(cut(run, 0, hazard.disappearsAt - 1).run.grenadesHit, 1);
  const safe = cut(run, 0, hazard.disappearsAt);
  assert.equal(safe.cutAccepted, true);
  assert.equal(safe.run.grenadesHit, 0);
  const first = cut(run, 22, run.startsAt + 100).run;
  assert.deepEqual(first.pizzas[0].completedCuts, [0]);
  const duplicateHits = cut(first, 12, run.startsAt + 200);
  assert.equal(duplicateHits.cutAccepted, false);
  assert.equal(duplicateHits.run.grenadesHit, 1);
});

test('late catch-up is identical to checking every scheduled batch and never resets clocks', () => {
  const original = makeRun();
  function input() {
    let seed = 123;
    let count = 0;
    return { random: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), id: () => 'catchup-' + (++count) };
  }
  const first = input();
  const second = input();
  let stepped = original;
  for (let index = 1; index <= 12; index += 1) {
    stepped = advanceRun(stepped, original.startsAt + index * 5000, first.random, first.id);
  }
  const delayed = advanceRun(original, original.endsAt + 120000, second.random, second.id);
  assert.deepEqual(delayed, stepped);
  assert.equal(delayed.pizzasMissed, 24);
  assert.equal(delayed.lastEvents.length, 3);
  assert.equal(delayed.finishedAt, original.endsAt);
  assert.equal(delayed.elapsedMs, 60000);
  assert.strictEqual(advance(delayed, original.endsAt + 150000), delayed);
});

test('the final batch is penalized before the win/loss verdict, including an exact-deadline cut', () => {
  let run = lastWave(225);
  for (const pizza of [...run.pizzas].slice(0, 2)) run = complete(run, pizza.id);
  run = cut(run, 17.25, run.endsAt - 2).run;
  assert.equal(run.score, 230);
  assert.equal(run.status, 'playing');
  const tooLate = cut(run, 107.25, run.endsAt);
  assert.equal(tooLate.cutAccepted, false);
  assert.equal(tooLate.run.pizzasMissed, 1);
  assert.equal(tooLate.run.score, 225);
  assert.equal(tooLate.run.status, 'lost');
  assert.equal(tooLate.run.reason, 'time_up');
  const justBefore = cut(run, 107.25, run.endsAt - 0.01);
  assert.equal(justBefore.cutAccepted, true);
  assert.equal(justBefore.run.status, 'playing');
  const final = advance(justBefore.run, run.endsAt);
  assert.equal(final.score, 240);
  assert.equal(final.pizzasCompleted, 24);
  assert.equal(final.pizzasMissed, 0);
  assert.equal(final.status, 'won');
  assert.equal(final.reason, 'personal_best');
  assert.equal(final.finishedAt, run.endsAt);
  assert.equal(final.waveIndex, 11);
  assert.equal(final.waveStartsAt, run.startsAt + 55000);
});

test('early target scores do not end a run and later misses can remove the lead', () => {
  const earned = complete(makeRun({ bestScore: 5 }));
  assert.equal(earned.score, 10);
  assert.equal(earned.status, 'playing');
  const final = advance(earned, earned.endsAt + 60000);
  assert.equal(final.score, 0);
  assert.equal(final.pizzasMissed, 23);
  assert.equal(final.status, 'lost');
  assert.equal(final.targetScore, 6);
  assert.equal(isRunOver(final), true);
  const ignored = gesture(final, across(), final.endsAt + 60000);
  assert.strictEqual(ignored.run, final);
  assert.equal(ignored.cutAccepted, false);
});

test('zero preparation allows immediate play without changing batch or run duration', () => {
  const run = makeRun({ preparationMs: 0 });
  assert.equal(run.status, 'playing');
  assert.equal(run.startsAt, run.createdAt);
  assert.equal(run.waveEndsAt - run.startsAt, 5000);
  assert.equal(run.endsAt - run.startsAt, 60000);
  assert.equal(complete(run, run.pizzas[0].id, run.startsAt).score, 10);
});

test('public snapshots hide bookkeeping and clone live pizzas, events, hazards, and counters', () => {
  const completed = complete(makeRun({ grenade: 0.99 }));
  let run = advance(completed, completed.waveEndsAt, draws(0.5, 0.99, 0));
  run = cut(run, 0).run;
  const snapshot = structuredClone(run);
  const view = toPublicRun(run, run.waveStartsAt + 1900);
  assert.deepEqual(Object.keys(view).sort(), [
    'id', 'playerId', 'status', 'reason', 'startsAt', 'endsAt', 'serverTime', 'remainingMs', 'countdownMs',
    'elapsedMs', 'bestBefore', 'targetScore', 'score', 'pizzasCompleted', 'pizzasSpoiled', 'grenadesHit',
    'pizzasMissed', 'pizzaCountsBySize', 'waveIndex', 'waveId', 'waveStartsAt', 'waveEndsAt',
    'difficultyLevel', 'pizzas', 'lastEvents'
  ].sort());
  for (const pizza of [view.pizzas[0], view.lastEvents[0].pizza]) {
    assert.deepEqual(Object.keys(pizza).sort(), ['id', 'pizzaSize', 'requiredSlices', 'requiredCuts', 'x', 'y',
      'radius', 'cutAngles', 'currentSlices', 'grenade'].sort());
    pizza.cutAngles.push(123);
    pizza.grenade.x = 999;
  }
  view.pizzaCountsBySize[10] = 999;
  view.lastEvents[0].outcome = 'spoiled';
  view.pizzas.pop();
  assert.deepEqual(run, snapshot);
});

test('partial and ignored cuts preserve the latest outcome event IDs without replaying new events', () => {
  const original = makeRun();
  let run = advance(original, original.startsAt + 20000);
  run = complete(run);
  const events = run.lastEvents;
  const count = run.eventSerial;
  run = cut(run, 0).run;
  assert.strictEqual(run.lastEvents, events);
  assert.equal(run.eventSerial, count);
  const duplicate = cut(run, 0).run;
  assert.strictEqual(duplicate.lastEvents, events);
  assert.equal(duplicate.eventSerial, count);
});

test('rules and immutable updates preserve private request bookkeeping and input snapshots', () => {
  const config = structuredClone(rules);
  const original = createRun({ id: 'immutable', playerId: 'p', requestId: 's', bestScore: 0 }, config, 1000, () => 0, nextId);
  config.pizzas[0].slices = 2;
  config.preparationMs = 0;
  assert.equal(original.rulesSnapshot.pizzas[0].slices, 4);
  assert.equal(original.rulesSnapshot.preparationMs, 3000);
  const privateRun = { ...original, startRequestIds: ['s', 'alias'], cutRequestIds: ['old-cut'], recorded: false };
  const snapshot = structuredClone(privateRun);
  const updated = complete(privateRun);
  assert.deepEqual(updated.startRequestIds, ['s', 'alias']);
  assert.deepEqual(updated.cutRequestIds, ['old-cut']);
  assert.equal(updated.recorded, false);
  assert.deepEqual(privateRun, snapshot);
  assert.deepEqual(SCORE_RULES, { completedPizza: 10, wrongCut: 5, grenade: 10, missedPizza: 5 });
  assert.ok(Object.isFrozen(DIFFICULTY_LEVELS[2]));
});

test('malformed settings, IDs, scores, clocks, random draws, and world coordinates are rejected', () => {
  for (const bad of [null, {}, { ...rules, mode: 'arcade-3' }, { ...rules, runDurationMs: 20000 },
    { ...rules, waveDurationMs: 4000 }, { ...rules, preparationMs: -1 }, { ...rules, preparationMs: 0.5 },
    { ...rules, pizzas: [{ sizeInches: 8, slices: 4 }, ...rules.pizzas.slice(1)] },
    { ...rules, pizzas: [rules.pizzas[0], rules.pizzas[0], rules.pizzas[2]] },
    { ...rules, pizzas: [{ sizeInches: 10, slices: 6 }, ...rules.pizzas.slice(1)] }]) assert.throws(() => validateRules(bad));
  const identity = { id: 'r', playerId: 'p', requestId: 'q', bestScore: 0 };
  for (const bad of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER, '10']) {
    assert.throws(() => createRun({ ...identity, bestScore: bad }, rules, 0));
  }
  assert.throws(() => createRun({ ...identity, id: '' }, rules, 0));
  for (const bad of [-0.1, 1, NaN]) assert.throws(() => createRun(identity, rules, 0, () => bad));
  assert.throws(() => createRun(identity, rules, 0, () => 0, () => ''));
  assert.throws(() => createRun(identity, rules, 0, () => 0, () => 'same-id'));
  const run = makeRun();
  for (const bad of [-1, NaN, Infinity]) assert.throws(() => advance(run, bad));
  for (const stroke of [
    { start: { x: NaN, y: 0 }, end: { x: 30, y: 0 } },
    { start: { x: -200.01, y: 0 }, end: { x: 30, y: 0 } },
    { start: { x: '-30', y: 0 }, end: { x: 30, y: 0 } }
  ]) assert.throws(() => gesture(run, stroke));
  assert.throws(() => applyRunCut(run, strokeForAngle(0), run.startsAt));
  assert.throws(() => strokeForPizza(null, 0));
  assert.throws(() => strokeForAngle(Infinity));
  assert.throws(() => normaliseAngle(NaN));
  assert.equal(normaliseAngle(-15), 165);
  assert.equal(normaliseAngle(375), 15);
  assert.equal(isRunOver(null), false);
});
