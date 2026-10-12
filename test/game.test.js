import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateRules, createRun, advanceRun, applyRunCut, toPublicRun,
  strokeForAngle, normaliseAngle, isRunOver, SCORE_RULES, DIFFICULTY_LEVELS
} from '../game.js';

const rules = validateRules(JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8')));
let serial = 0;
const nextPizzaId = () => 'pizza-' + (++serial);
const draws = (...values) => () => values.shift() ?? 0;

function makeRun({ size = 0, rotation = 0, grenade = 0, guide = 0, side = 0,
  bestScore = 0, preparationMs = rules.preparationMs } = {}) {
  return createRun({ id: 'run-' + (++serial), playerId: 'player-one',
    requestId: 'start-' + serial, bestScore },
  { ...rules, preparationMs }, 1000, draws(size, rotation, grenade, guide, side), nextPizzaId);
}

function cut(run, angle, nowMs = run.startsAt + 100, random = () => 0) {
  return applyRunCut(run, { pizzaId: run.currentPizza.id, ...strokeForAngle(angle) }, nowMs, random, nextPizzaId);
}

function gesture(run, stroke, nowMs = run.startsAt + 100) {
  return applyRunCut(run, { pizzaId: run.currentPizza.id, ...stroke }, nowMs, () => 0, nextPizzaId);
}

function complete(run, nowMs = run.startsAt + 100, random = () => 0) {
  const angles = [...run.currentPizza.guideAngles];
  for (const angle of angles) run = cut(run, angle, nowMs, random).run;
  return run;
}

test('each random size has the exact slice and diameter-cut mapping', () => {
  for (const [roll, size, slices, cuts] of [[0, 14, 8, 4], [0.5, 10, 6, 3], [0.9, 8, 4, 2]]) {
    const run = makeRun({ size: roll });
    assert.equal(run.currentPizza.pizzaSize, size);
    assert.equal(run.currentPizza.requiredSlices, slices);
    assert.equal(run.currentPizza.requiredCuts, cuts);
    assert.equal(run.currentPizza.guideAngles.length, cuts);
    assert.equal(toPublicRun(run, run.createdAt).currentPizza.currentSlices, 1);
    assert.equal(run.currentPizza.grenade, null);
  }
});

test('rotations preserve equal spacing and reverse angles describe the same diameter', () => {
  const pizza = makeRun({ rotation: 0.6 }).currentPizza;
  assert.deepEqual(pizza.guideAngles, [105, 150, 15, 60]);
  const sorted = [...pizza.guideAngles].sort((a, b) => a - b);
  sorted.forEach((angle, index) => assert.equal((sorted[(index + 1) % sorted.length] - angle + 180) % 180, 45));
  assert.equal(normaliseAngle(-15), 165);
  assert.equal(normaliseAngle(375), 15);
});

test('preparation accepts neither cuts nor grenade hits and leaves a full minute to play', () => {
  const run = makeRun({ grenade: 0.99 });
  const early = cut(run, 0, run.startsAt - 1);
  assert.equal(early.run.status, 'countdown');
  assert.equal(early.cutAccepted, false);
  assert.equal(early.run.grenadesHit, 0);
  assert.deepEqual(early.run.currentPizza.completedCuts, []);
  const view = toPublicRun(early.run, run.startsAt - 1);
  assert.equal(view.countdownMs, 1);
  assert.equal(view.remainingMs, 60000);
  assert.equal(run.currentPizza.grenade.appearsAt, run.startsAt);
  const playing = advanceRun(run, run.startsAt);
  assert.equal(playing.status, 'playing');
  assert.equal(toPublicRun(playing, run.startsAt).remainingMs, 60000);
  assert.equal(run.status, 'countdown');
});

test('every required distinct cut completes a pizza, scores once, and immediately replaces it', () => {
  for (const size of [0, 0.5, 0.9]) {
    const original = makeRun({ size });
    let run = original;
    original.currentPizza.guideAngles.forEach((angle, index) => {
      const result = cut(run, angle);
      run = result.run;
      assert.equal(result.cutAccepted, true);
      assert.equal(run.status, 'playing');
      assert.equal(run.score, index + 1 === original.currentPizza.requiredCuts ? 10 : 0);
    });
    assert.equal(run.pizzasCompleted, 1);
    assert.equal(run.pizzaCountsBySize[original.currentPizza.pizzaSize], 1);
    assert.equal(run.lastPizza.outcome, 'completed');
    assert.equal(run.lastPizza.id, original.currentPizza.id);
    assert.equal(toPublicRun(run, run.startsAt + 100).lastPizza.currentSlices, original.currentPizza.requiredSlices);
    assert.notEqual(run.currentPizza.id, original.currentPizza.id);
    assert.deepEqual(run.currentPizza.completedCuts, []);
    assert.equal(run.endsAt, original.endsAt);
    assert.equal(run.finishedAt, null);
    assert.deepEqual(original.currentPizza.completedCuts, []);
  }
});

test('successive random pizzas share one score and one unchanging deadline', () => {
  const original = makeRun();
  let run = complete(original, original.startsAt + 100, draws(0.5, 0.25, 0));
  assert.equal(run.currentPizza.pizzaSize, 10);
  run = complete(run, original.startsAt + 800, draws(0.9, 0.5, 0));
  assert.equal(run.currentPizza.pizzaSize, 8);
  run = complete(run, original.startsAt + 1200);
  assert.equal(run.score, 30);
  assert.equal(run.pizzasCompleted, 3);
  assert.deepEqual(run.pizzaCountsBySize, { 8: 1, 10: 1, 14: 1 });
  assert.equal(run.startsAt, original.startsAt);
  assert.equal(run.endsAt, original.endsAt);
  assert.equal(run.status, 'playing');
});

test('a repeated diameter including its reverse does not count twice', () => {
  const original = makeRun();
  const first = cut(original, 0).run;
  const stroke = strokeForAngle(0);
  const duplicate = gesture(first, { start: stroke.end, end: stroke.start });
  assert.equal(duplicate.cutAccepted, false);
  assert.strictEqual(duplicate.run, first);
  assert.deepEqual(duplicate.run.currentPizza.completedCuts, [0]);
  assert.equal(duplicate.run.score, 0);
  assert.match(duplicate.feedback, /already/);
});

test('wrong cuts deduct five, stop at zero, replace the pizza, and never end the run early', () => {
  const original = complete(makeRun());
  let run = original;
  for (const expected of [5, 0, 0]) {
    const previousId = run.currentPizza.id;
    const result = cut(run, 22.5);
    run = result.run;
    assert.equal(result.cutAccepted, false);
    assert.equal(run.score, expected);
    assert.equal(run.status, 'playing');
    assert.equal(run.lastPizza.outcome, 'spoiled');
    assert.notEqual(run.currentPizza.id, previousId);
    assert.equal(run.endsAt, original.endsAt);
  }
  assert.equal(run.pizzasSpoiled, 3);
  assert.equal(run.pizzasCompleted, 1);
  assert.equal(run.grenadesHit, 0);
  assert.equal(original.score, 10);
});

test('an off-centre chord spoils the pizza even if its angle follows a guide', () => {
  const run = makeRun();
  const result = gesture(run, { start: { x: -1, y: 0.3 }, end: { x: 1, y: 0.3 } });
  assert.equal(result.run.pizzasSpoiled, 1);
  assert.equal(result.run.lastPizza.outcome, 'spoiled');
  assert.equal(result.run.status, 'playing');
});

test('short, incomplete, outside, and stationary swipes without hazards are harmless', () => {
  const original = makeRun();
  const run = advanceRun(original, original.startsAt);
  for (const stroke of [
    { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    { start: { x: -1, y: 0 }, end: { x: -0.9, y: 0 } },
    { start: { x: -0.8, y: 1.4 }, end: { x: 0.8, y: 1.4 } },
    { start: { x: -2, y: 0 }, end: { x: 2, y: 0 } },
    { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }
  ]) {
    const result = gesture(run, stroke);
    assert.strictEqual(result.run, run);
    assert.equal(result.cutAccepted, false);
    assert.equal(result.run.pizzasSpoiled, 0);
  }
});

test('inclusive angle and centre tolerance accept practical cuts while the next amount spoils', () => {
  const run = makeRun();
  assert.equal(cut(run, 10).cutAccepted, true);
  assert.equal(gesture(run, { start: { x: -1, y: 0.12 }, end: { x: 1, y: 0.12 } }).cutAccepted, true);
  assert.equal(cut(run, 10.01).run.pizzasSpoiled, 1);
  assert.equal(gesture(run, { start: { x: -1, y: 0.121 }, end: { x: 1, y: 0.121 } }).run.pizzasSpoiled, 1);
});

test('a stale pizza ID cannot score or hit the replacement pizza’s grenade', () => {
  const original = makeRun();
  const run = complete(original, original.startsAt + 100, draws(0, 0, 0.99, 0, 0));
  assert.ok(run.currentPizza.grenade);
  const stale = applyRunCut(run, { pizzaId: original.currentPizza.id, ...strokeForAngle(0) },
    run.startsAt + 200, () => 0, nextPizzaId);
  assert.strictEqual(stale.run, run);
  assert.equal(stale.cutAccepted, false);
  assert.equal(stale.run.score, 10);
  assert.equal(stale.run.grenadesHit, 0);
});

test('a grenade costs ten with no additional wrong-cut penalty, then play continues', () => {
  let run = complete(makeRun());
  run = complete(run, run.startsAt + 200, draws(0, 0, 0.99, 0, 0));
  assert.equal(run.score, 20);
  const hit = cut(run, 15, run.startsAt + 300);
  assert.equal(hit.run.score, 10);
  assert.equal(hit.run.grenadesHit, 1);
  assert.equal(hit.run.pizzasSpoiled, 0);
  assert.equal(hit.run.pizzasCompleted, 2);
  assert.equal(hit.run.lastPizza.outcome, 'grenade');
  assert.equal(hit.cutAccepted, false);
  assert.equal(hit.run.status, 'playing');
  assert.equal(hit.run.endsAt, run.endsAt);
  assert.equal(cut(makeRun({ grenade: 0.99 }), 0).run.score, 0);
});

test('grenade collision follows the actual swipe segment, including short strokes and tangents', () => {
  const run = makeRun({ grenade: 0.99 });
  const short = gesture(run, { start: { x: 0.55, y: 0 }, end: { x: 0.85, y: 0 } });
  assert.equal(short.run.grenadesHit, 1);
  const tangent = gesture(run, { start: { x: 0.5, y: 0.19 }, end: { x: 0.9, y: 0.19 } });
  assert.equal(tangent.run.grenadesHit, 1);
  for (const stroke of [
    { start: { x: 0.3, y: 0 }, end: { x: 0.5, y: 0 } },
    { start: { x: 0.7, y: 0 }, end: { x: 0.7, y: 0 } },
    { start: { x: 0.65, y: 0 }, end: { x: 0.75, y: 0 } },
    { start: { x: 0.5, y: 0.191 }, end: { x: 0.9, y: 0.191 } }
  ]) assert.equal(gesture(run, stroke).run.grenadesHit, 0);
});

test('grenades activate at spawn and are harmless at their exact expiry', () => {
  const run = makeRun({ grenade: 0.99 });
  const hazard = run.currentPizza.grenade;
  assert.equal(cut(run, 0, hazard.appearsAt).run.grenadesHit, 1);
  assert.equal(cut(run, 0, hazard.disappearsAt - 1).run.grenadesHit, 1);
  const safe = cut(run, 0, hazard.disappearsAt);
  assert.equal(safe.cutAccepted, true);
  assert.equal(safe.run.grenadesHit, 0);
  assert.deepEqual(safe.run.currentPizza.completedCuts, [0]);
});

test('an active grenade takes priority over a duplicate-guide check', () => {
  const run = makeRun({ grenade: 0.99 });
  const withPreviousCut = { ...run, currentPizza: { ...run.currentPizza, completedCuts: [0] } };
  const hit = cut(withPreviousCut, 0);
  assert.equal(hit.run.grenadesHit, 1);
  assert.equal(hit.run.lastPizza.outcome, 'grenade');
});

test('new pizzas progress at 20 and 40 seconds while the current pizza keeps its difficulty', () => {
  const original = makeRun();
  for (const [elapsed, level, tolerance] of [[19999, 1, 10], [20000, 2, 8], [39999, 2, 8], [40000, 3, 6]]) {
    const result = cut(original, 22.5, original.startsAt + elapsed);
    assert.equal(result.run.currentPizza.difficultyLevel, level);
    assert.equal(result.run.currentPizza.angleToleranceDeg, tolerance);
  }
  const samePizza = cut(original, 10, original.startsAt + 41000);
  assert.equal(samePizza.cutAccepted, true);
  assert.equal(samePizza.run.currentPizza.difficultyLevel, 1);
  const harder = cut(original, 22.5, original.startsAt + 40000).run;
  assert.equal(cut(harder, 6, original.startsAt + 40100).cutAccepted, true);
  assert.equal(cut(harder, 6.01, original.startsAt + 40100).run.pizzasSpoiled, 2);
});

test('later levels weight random sizes toward larger pizzas', () => {
  const original = makeRun();
  for (const [roll, expectedSizes] of [[0.45, [10, 14, 14]], [0.60, [10, 10, 14]], [0.85, [8, 8, 10]]]) {
    const sizes = [1000, 20000, 40000].map((elapsed) =>
      cut(original, 22.5, original.startsAt + elapsed, draws(roll, 0, 0)).run.currentPizza.pizzaSize);
    assert.deepEqual(sizes, expectedSizes);
  }
});

test('grenades become more likely and last longer at higher levels', () => {
  const original = makeRun();
  for (const [roll, expected] of [[0.8, [false, true, true]], [0.6, [false, false, true]]]) {
    [1000, 20000, 40000].forEach((elapsed, index) => {
      const pizza = cut(original, 22.5, original.startsAt + elapsed, draws(0, 0, roll, 0.3, 0.8)).run.currentPizza;
      assert.equal(Boolean(pizza.grenade), expected[index]);
      if (pizza.grenade) {
        assert.equal(pizza.grenade.disappearsAt - pizza.grenade.appearsAt, [1600, 1900, 2200][index]);
        assert.ok(Math.abs(Math.hypot(pizza.grenade.x, pizza.grenade.y) - 0.7) < 1e-9);
        assert.equal(pizza.grenade.radius, 0.19);
      }
    });
  }
});

test('beating the target early does not finish the run; only the final score decides', () => {
  const original = makeRun({ bestScore: 15 });
  let run = complete(complete(original));
  assert.equal(run.score, 20);
  assert.equal(run.status, 'playing');
  assert.equal(run.targetScore, 16);
  run = cut(run, 22.5).run;
  assert.equal(run.score, 15);
  const final = advanceRun(run, original.endsAt);
  assert.equal(final.status, 'lost');
  assert.equal(final.reason, 'time_up');
  assert.equal(final.bestBefore, 15);
  assert.equal(final.elapsedMs, 60000);
});

test('the exact deadline ignores a final cut while a cut just before it still counts', () => {
  const original = makeRun({ size: 0.9 });
  const partial = cut(original, original.currentPizza.guideAngles[0]).run;
  const lastAngle = original.currentPizza.guideAngles[1];
  const atDeadline = cut(partial, lastAngle, original.endsAt);
  assert.equal(atDeadline.cutAccepted, false);
  assert.equal(atDeadline.run.score, 0);
  assert.equal(atDeadline.run.status, 'lost');
  assert.equal(atDeadline.run.currentPizza.completedCuts.length, 1);
  const justBefore = cut(partial, lastAngle, original.endsAt - 0.01);
  assert.equal(justBefore.cutAccepted, true);
  assert.equal(justBefore.run.status, 'playing');
  const final = advanceRun(justBefore.run, original.endsAt);
  assert.equal(final.status, 'won');
  assert.equal(final.reason, 'personal_best');
  assert.equal(final.score, 10);
  assert.equal(final.finishedAt, original.endsAt);
  assert.equal(final.elapsedMs, 60000);
});

test('late checks settle at the original deadline and terminal outcomes cannot change', () => {
  for (const run of [makeRun(), complete(makeRun())]) {
    const final = advanceRun(run, run.endsAt + 60000);
    assert.equal(final.finishedAt, run.endsAt);
    assert.equal(final.elapsedMs, 60000);
    assert.equal(toPublicRun(final, run.endsAt + 60000).remainingMs, 0);
    assert.strictEqual(advanceRun(final, run.endsAt + 90000), final);
    assert.strictEqual(cut(final, 22.5, run.endsAt + 90000).run, final);
    assert.equal(isRunOver(final), true);
  }
});

test('zero preparation supports immediate play without shortening the minute', () => {
  const run = makeRun({ preparationMs: 0 });
  assert.equal(run.status, 'playing');
  const scored = complete(run, run.startsAt);
  assert.equal(scored.score, 10);
  assert.equal(scored.status, 'playing');
  assert.equal(scored.endsAt - scored.startsAt, 60000);
});

test('public state hides bookkeeping and clones every mutable game detail', () => {
  const run = complete(makeRun(), 4100, draws(0, 0, 0.99, 0, 0));
  const view = toPublicRun(run, 4100);
  for (const key of ['requestId', 'startRequestIds', 'cutRequestIds', 'recorded', 'rulesSnapshot', 'createdAt']) {
    assert.equal(view[key], undefined);
  }
  view.currentPizza.guideAngles.push(123);
  view.currentPizza.completedCuts.push(0);
  view.currentPizza.grenade.x = 99;
  view.lastPizza.completedCuts.pop();
  view.pizzaCountsBySize[14] = 9000;
  assert.equal(run.currentPizza.guideAngles.length, 4);
  assert.deepEqual(run.currentPizza.completedCuts, []);
  assert.equal(run.currentPizza.grenade.x, 0.7);
  assert.equal(run.lastPizza.completedCuts.length, 4);
  assert.equal(run.pizzaCountsBySize[14], 1);
});

test('rules snapshots and immutable updates preserve request bookkeeping', () => {
  const config = structuredClone(rules);
  const original = createRun({ id: 'immutable', playerId: 'p', requestId: 's', bestScore: 0 },
    config, 1000, () => 0, nextPizzaId);
  config.pizzas[0].slices = 2;
  config.preparationMs = 0;
  assert.equal(original.rulesSnapshot.pizzas[0].slices, 8);
  assert.equal(original.rulesSnapshot.preparationMs, 3000);
  const privateRun = { ...original, startRequestIds: ['s', 'alias'], cutRequestIds: ['old-cut'], recorded: false };
  const updated = complete(privateRun);
  assert.deepEqual(updated.startRequestIds, ['s', 'alias']);
  assert.deepEqual(updated.cutRequestIds, ['old-cut']);
  assert.equal(updated.recorded, false);
  assert.deepEqual(original.currentPizza.completedCuts, []);
  assert.deepEqual(SCORE_RULES, { completedPizza: 10, wrongCut: 5, grenade: 10 });
  assert.ok(Object.isFrozen(DIFFICULTY_LEVELS[2].pizzaWeights));
});

test('malformed settings, IDs, best scores, clocks, randomness, and coordinates are rejected', () => {
  for (const bad of [null, {}, { ...rules, runDurationMs: 20000 }, { ...rules, runDurationMs: '60000' },
    { ...rules, preparationMs: -1 }, { ...rules, preparationMs: 0.5 },
    { ...rules, pizzas: [{ sizeInches: 16, slices: 8 }, ...rules.pizzas.slice(1)] },
    { ...rules, pizzas: [rules.pizzas[0], rules.pizzas[0], rules.pizzas[2]] },
    { ...rules, pizzas: [{ sizeInches: 14, slices: 6 }, ...rules.pizzas.slice(1)] }]) {
    assert.throws(() => validateRules(bad));
  }
  const identity = { id: 'r', playerId: 'p', requestId: 'q', bestScore: 0 };
  for (const bad of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER, '10']) {
    assert.throws(() => createRun({ ...identity, bestScore: bad }, rules, 0));
  }
  assert.throws(() => createRun({ ...identity, id: '' }, rules, 0));
  for (const bad of [-0.1, 1, NaN]) assert.throws(() => createRun(identity, rules, 0, () => bad));
  assert.throws(() => createRun(identity, rules, 0, () => 0, () => ''));
  const run = makeRun();
  for (const bad of [-1, NaN, Infinity]) assert.throws(() => advanceRun(run, bad));
  for (const stroke of [
    { start: { x: NaN, y: 0 }, end: { x: 1, y: 0 } },
    { start: { x: -4, y: 0 }, end: { x: 1, y: 0 } },
    { start: { x: '-1', y: 0 }, end: { x: 1, y: 0 } }
  ]) assert.throws(() => gesture(run, stroke));
  assert.throws(() => applyRunCut(run, strokeForAngle(0), run.startsAt));
  assert.throws(() => strokeForAngle(Infinity));
  assert.throws(() => normaliseAngle(NaN));
  assert.equal(isRunOver(null), false);
});
