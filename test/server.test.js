import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createAppServer } from '../server.js';

// Real HTTP requests use temporary files, an unused local port, and a controlled clock.
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pizza-rush-test-'));
  const publicDir = join(directory, 'public');
  const dataFile = join(directory, '.data', 'rush.json');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><h1>Rush test</h1>');
  const rules = { ...JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8')), ...options.rules };
  await writeFile(join(publicDir, 'game-rules.json'), JSON.stringify(rules));
  let now = 1_000_000;
  let nextClockHook = null;
  let randomSequence = options.randomSequence || [0];
  let randomIndex = 0;
  let randomCalls = 0;
  const servers = [];
  const clock = () => {
    const hook = nextClockHook;
    nextClockHook = null;
    if (hook) hook();
    return now;
  };
  const random = () => {
    randomCalls += 1;
    return randomSequence[randomIndex++ % randomSequence.length];
  };
  t.after(async () => {
    for (const server of servers) if (server.listening) await close(server);
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    const server = await createAppServer({ dataFile, publicDir, clock, random });
    assert.equal(server.listening, false);
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, method = 'GET', body) {
      const response = await fetch(base + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
    }
    return { server, base, request };
  }
  return {
    directory, publicDir, dataFile, rules, start,
    setTime(value) { now = value; },
    onNextClock(hook) { nextClockHook = hook; },
    setRandom(sequence) { randomSequence = sequence; randomIndex = 0; },
    getRandomCalls() { return randomCalls; },
    ...(await start())
  };
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function stroke(angle, radius = 1.05) {
  const radians = angle * Math.PI / 180;
  const x = Math.cos(radians) * radius;
  const y = Math.sin(radians) * radius;
  return { start: { x: -x, y: -y }, end: { x, y } };
}

function grenadeStroke(grenade, halfLength = 0.1) {
  return {
    start: { x: grenade.x - halfLength, y: grenade.y },
    end: { x: grenade.x + halfLength, y: grenade.y }
  };
}

const unevenStroke = { start: { x: -1, y: 0.3 }, end: { x: 1, y: 0.3 } };

async function addPlayer(fixture, name = 'Adzan') {
  const response = await fixture.request('/api/players', 'POST', { name });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

async function newRun(fixture, playerId, requestId) {
  const response = await fixture.request('/api/runs', 'POST', { playerId, requestId });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.run;
}

async function cut(fixture, run, requestId, coordinates, pizzaId = run.currentPizza.id) {
  return fixture.request(`/api/runs/${run.id}/cuts`, 'POST', { requestId, pizzaId, ...coordinates });
}

async function completePizza(fixture, run, elapsedMs, prefix = run.currentPizza.id) {
  fixture.setTime(run.startsAt + elapsedMs);
  const pizza = run.currentPizza;
  let response;
  for (let index = 0; index < pizza.requiredCuts; index += 1) {
    if (pizza.completedCuts.includes(index)) continue;
    response = await cut(fixture, run, `${prefix}-cut-${index}`, stroke(pizza.guideAngles[index]));
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  assert.equal(response.body.run.status, 'playing');
  assert.equal(response.body.run.pizzasCompleted, run.pizzasCompleted + 1);
  assert.equal(response.body.run.lastPizza.id, pizza.id);
  assert.equal(response.body.run.lastPizza.outcome, 'completed');
  return response.body;
}

async function finishRun(fixture, run) {
  fixture.setTime(run.endsAt);
  const response = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function assertPublicPlayer(player) {
  assert.deepEqual(Object.keys(player).sort(), [
    'bestPizzaCount', 'bestScore', 'id', 'name', 'runsLost', 'runsPlayed', 'runsWon', 'totalPizzasCompleted'
  ]);
}

function assertPublicPizza(pizza, isLast = false) {
  assert.deepEqual(Object.keys(pizza).sort(), [
    'angleToleranceDeg', 'completedCuts', 'currentSlices', 'difficultyLevel', 'grenade',
    'guideAngles', 'id', ...(isLast ? ['outcome'] : []), 'pizzaSize', 'requiredCuts', 'requiredSlices'
  ].sort());
  if (pizza.grenade) {
    assert.deepEqual(Object.keys(pizza.grenade).sort(), ['appearsAt', 'disappearsAt', 'radius', 'x', 'y']);
  }
}

function assertPublicRun(run) {
  assert.deepEqual(Object.keys(run).sort(), [
    'bestBefore', 'countdownMs', 'currentPizza', 'elapsedMs', 'endsAt', 'grenadesHit', 'id',
    'lastPizza', 'pizzaCountsBySize', 'pizzasCompleted', 'pizzasSpoiled', 'playerId', 'reason',
    'remainingMs', 'score', 'serverTime', 'startsAt', 'status', 'targetScore'
  ]);
  assertPublicPizza(run.currentPizza);
  if (run.lastPizza) assertPublicPizza(run.lastPizza, true);
}

test('solo profiles keep strict CRUD, unique names and fresh Rush data while preserving the earlier game file', async (t) => {
  const fixture = await setup(t);
  const oldFile = join(dirname(fixture.dataFile), 'game.json');
  const oldProgress = '{"earlierGame":"preserve this progress exactly"}\n';
  await mkdir(dirname(fixture.dataFile));
  await writeFile(oldFile, oldProgress);
  const initial = await fixture.request('/api/players');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, []);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const player = await addPlayer(fixture, '  Adzan  ');
  assertPublicPlayer(player);
  assert.deepEqual(player, {
    id: player.id, name: 'Adzan', runsPlayed: 0, runsWon: 0, runsLost: 0,
    bestScore: 0, bestPizzaCount: 0, totalPizzasCompleted: 0
  });
  assert.equal((await fixture.request('/api/players', 'POST', { name: 'ADZAN' })).status, 409);
  const other = await addPlayer(fixture, 'Alia');
  assert.equal((await fixture.request(`/api/players/${other.id}`, 'PATCH', { name: ' adzan ' })).status, 409);
  const renamed = await fixture.request(`/api/players/${player.id}`, 'PATCH', { name: 'ADZAN' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.id, player.id);
  assert.equal(renamed.body.name, 'ADZAN');
  for (const body of [null, [], {}, { name: '' }, { name: '  ' }, { name: 12 }, { name: 'x'.repeat(25) },
    { name: 'Valid', runsWon: 5 }]) {
    assert.equal((await fixture.request('/api/players', 'POST', body)).status, 400);
  }
  for (const body of [{ runsWon: 10 }, { runsLost: 0 }, { completedRoundId: 'old-client' },
    { roundResult: { outcome: 'won', elapsedMs: 1 } }, { bestScore: 9000 }, { bestPizzaCount: 100 }]) {
    assert.equal((await fixture.request(`/api/players/${player.id}`, 'PATCH', body)).status, 400);
  }
  const run = await newRun(fixture, player.id, 'crud-run');
  assert.equal((await fixture.request(`/api/players/${player.id}`, 'DELETE')).status, 204);
  assert.equal((await fixture.request(`/api/runs/${run.id}`)).status, 404);
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.players.length, 1);
  assert.deepEqual(state.runs, []);
  assert.equal((await fixture.request(`/api/players/${player.id}`, 'DELETE')).status, 404);
  assert.equal(await readFile(oldFile, 'utf8'), oldProgress);
});

test('server-selected pizzas share one full minute, score ten points, and never produce an early win', async (t) => {
  const fixture = await setup(t, { randomSequence: [0.4, 0.25, 0] });
  const player = await addPlayer(fixture);
  const run = await newRun(fixture, player.id, 'minute-run');
  assertPublicRun(run);
  assert.equal(run.currentPizza.pizzaSize, 10);
  assert.equal(run.currentPizza.requiredSlices, 6);
  assert.deepEqual(run.currentPizza.guideAngles, [45, 105, 165]);
  assert.equal(run.currentPizza.grenade, null);
  assert.equal(run.status, 'countdown');
  assert.equal(run.countdownMs, 3000);
  assert.equal(run.remainingMs, 60000);
  assert.equal(run.endsAt - run.startsAt, 60000);
  assert.equal(run.bestBefore, 0);
  assert.equal(run.targetScore, 1);
  const early = await cut(fixture, run, 'before-go', stroke(45));
  assert.equal(early.body.run.status, 'countdown');
  assert.deepEqual(early.body.run.currentPizza.completedCuts, []);
  fixture.setTime(run.startsAt);
  const go = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(go.body.run.status, 'playing');
  assert.equal(go.body.run.remainingMs, 60000);
  const completed = await completePizza(fixture, run, 1234);
  assert.equal(completed.run.score, 10);
  assert.equal(completed.run.currentPizza.currentSlices, 1);
  assert.notEqual(completed.run.currentPizza.id, run.currentPizza.id);
  assert.equal(completed.run.countdownMs, 0);
  assert.equal(completed.run.endsAt, run.endsAt);
  assert.deepEqual(completed.run.pizzaCountsBySize, { '8': 0, '10': 1, '14': 0 });
  assert.equal(completed.player.runsPlayed, 0);
  assert.equal(completed.player.bestScore, 0);
  fixture.setTime(run.endsAt - 1);
  const almost = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(almost.body.run.status, 'playing');
  assert.equal(almost.body.run.remainingMs, 1);
  const finished = await finishRun(fixture, run);
  assert.equal(finished.run.status, 'won');
  assert.equal(finished.run.reason, 'personal_best');
  assert.equal(finished.run.elapsedMs, 60000);
  assert.equal(finished.run.remainingMs, 0);
  assert.equal(finished.player.runsPlayed, 1);
  assert.equal(finished.player.runsWon, 1);
  assert.equal(finished.player.bestScore, 10);
  assert.equal(finished.player.bestPizzaCount, 1);
  assert.equal(finished.player.totalPizzasCompleted, 1);
});

test('incomplete strokes and repeated guides are ignored, while wrong cuts deduct five with a zero floor', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const run = await newRun(fixture, player.id, 'cut-types');
  fixture.setTime(run.startsAt + 500);
  for (const [index, coordinates] of [
    { start: { x: 0, y: 0 }, end: { x: 0.2, y: 0.2 } },
    { start: { x: -3, y: -3 }, end: { x: 3, y: 3 } },
    { start: { x: -0.7, y: 1.1 }, end: { x: 0.7, y: 1.1 } }
  ].entries()) {
    const ignored = await cut(fixture, run, `ignored-${index}`, coordinates);
    assert.equal(ignored.status, 200);
    assert.equal(ignored.body.run.score, 0);
    assert.equal(ignored.body.run.pizzasSpoiled, 0);
    assert.deepEqual(ignored.body.run.currentPizza.completedCuts, []);
  }
  const accepted = await cut(fixture, run, 'accepted-guide', stroke(0));
  assert.equal(accepted.body.run.currentPizza.currentSlices, 2);
  const duplicate = await cut(fixture, run, 'duplicate-guide', stroke(180));
  assert.deepEqual(duplicate.body.run.currentPizza.completedCuts, [0]);
  const changedRetry = await cut(fixture, run, 'accepted-guide', unevenStroke);
  assert.equal(changedRetry.body.run.pizzasSpoiled, 0);
  assert.deepEqual(changedRetry.body.run.currentPizza.completedCuts, [0]);
  let current = (await completePizza(fixture, accepted.body.run, 500)).run;
  for (const [index, expectedScore] of [5, 0, 0].entries()) {
    const spoiled = await cut(fixture, current, `wrong-cut-${index}`, unevenStroke);
    assert.equal(spoiled.status, 200);
    assert.equal(spoiled.body.run.status, 'playing');
    assert.equal(spoiled.body.run.score, expectedScore);
    assert.equal(spoiled.body.run.pizzasSpoiled, index + 1);
    assert.equal(spoiled.body.run.pizzasCompleted, 1);
    assert.equal(spoiled.body.run.lastPizza.outcome, 'spoiled');
    assert.equal(spoiled.body.run.endsAt, run.endsAt);
    assert.notEqual(spoiled.body.run.currentPizza.id, current.currentPizza.id);
    current = spoiled.body.run;
  }
  const stale = await cut(fixture, current, 'stale-wrong-cut', unevenStroke, run.currentPizza.id);
  assert.equal(stale.body.run.pizzasSpoiled, 3);
  assert.equal(stale.body.run.currentPizza.id, current.currentPizza.id);
  assert.equal(stale.body.player.runsPlayed, 0);
});

test('grenade collision has one ten-point penalty; countdown, tiny, stale, expired and late gestures are safe', async (t) => {
  const fixture = await setup(t, { randomSequence: [0, 0, 0.99, 0, 0] });
  const player = await addPlayer(fixture);
  const run = await newRun(fixture, player.id, 'grenade-run');
  const initialGrenade = run.currentPizza.grenade;
  assert.equal(initialGrenade.appearsAt, run.startsAt);
  const early = await cut(fixture, run, 'countdown-grenade', grenadeStroke(initialGrenade));
  assert.equal(early.body.run.grenadesHit, 0);
  assert.equal(early.body.run.status, 'countdown');
  // The blocked guide becomes safe at the exact disappearance timestamp.
  let current = (await completePizza(fixture, run, initialGrenade.disappearsAt - run.startsAt)).run;
  assert.equal(current.score, 10);
  const tiny = await cut(fixture, current, 'tiny-grenade-stroke', grenadeStroke(current.currentPizza.grenade, 0.05));
  assert.equal(tiny.body.run.grenadesHit, 0);
  const grenadePizza = current.currentPizza;
  const hit = await cut(fixture, current, 'grenade-hit', grenadeStroke(grenadePizza.grenade));
  assert.equal(hit.body.run.score, 0);
  assert.equal(hit.body.run.grenadesHit, 1);
  assert.equal(hit.body.run.pizzasSpoiled, 0);
  assert.equal(hit.body.run.pizzasCompleted, 1);
  assert.equal(hit.body.run.lastPizza.outcome, 'grenade');
  assert.equal(hit.body.run.status, 'playing');
  current = hit.body.run;
  const retry = await cut(fixture, current, 'grenade-hit', grenadeStroke(current.currentPizza.grenade));
  assert.equal(retry.body.run.grenadesHit, 1);
  const stale = await cut(fixture, current, 'stale-grenade', grenadeStroke(current.currentPizza.grenade), grenadePizza.id);
  assert.equal(stale.body.run.grenadesHit, 1);
  assert.equal(stale.body.run.currentPizza.id, current.currentPizza.id);
  const anotherHit = await cut(fixture, current, 'zero-score-grenade', grenadeStroke(current.currentPizza.grenade));
  assert.equal(anotherHit.body.run.score, 0);
  assert.equal(anotherHit.body.run.grenadesHit, 2);
  assert.equal(anotherHit.body.run.pizzasSpoiled, 0);
  current = anotherHit.body.run;
  fixture.setTime(current.currentPizza.grenade.disappearsAt);
  const expired = await cut(fixture, current, 'at-grenade-expiry', stroke(current.currentPizza.guideAngles[0]));
  assert.equal(expired.body.run.grenadesHit, 2);
  assert.deepEqual(expired.body.run.currentPizza.completedCuts, [0]);
  fixture.setTime(run.endsAt);
  const late = await cut(fixture, current, 'after-run-deadline', grenadeStroke(current.currentPizza.grenade));
  assert.equal(late.body.run.status, 'lost');
  assert.equal(late.body.run.grenadesHit, 2);
  assert.equal(late.body.run.score, 0);
  assert.equal(late.body.player.runsLost, 1);
  assert.equal(late.body.player.bestPizzaCount, 1);
});

test('score and pizza records update independently, and penalties can erase an in-progress lead', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'first-best');
  run = (await completePizza(fixture, run, 1000)).run;
  run = (await completePizza(fixture, run, 2000)).run;
  const first = await finishRun(fixture, run);
  assert.equal(first.player.bestScore, 20);
  assert.equal(first.player.bestPizzaCount, 2);
  assert.equal(first.player.runsWon, 1);
  run = await newRun(fixture, player.id, 'more-pizzas-lower-score');
  assert.equal(run.bestBefore, 20);
  assert.equal(run.targetScore, 21);
  for (let index = 1; index <= 3; index += 1) run = (await completePizza(fixture, run, index * 1000)).run;
  assert.equal(run.score, 30);
  assert.equal(run.status, 'playing');
  for (let index = 0; index < 3; index += 1) {
    run = (await cut(fixture, run, `lose-lead-${index}`, unevenStroke)).body.run;
  }
  const second = await finishRun(fixture, run);
  assert.equal(second.run.score, 15);
  assert.equal(second.run.status, 'lost');
  assert.equal(second.run.reason, 'time_up');
  assert.equal(second.player.bestScore, 20);
  assert.equal(second.player.bestPizzaCount, 3);
  assert.equal(second.player.totalPizzasCompleted, 5);
  assert.equal(second.player.runsPlayed, 2);
  assert.equal(second.player.runsWon, 1);
  assert.equal(second.player.runsLost, 1);
  run = await newRun(fixture, player.id, 'tied-score');
  run = (await completePizza(fixture, run, 1000)).run;
  run = (await completePizza(fixture, run, 2000)).run;
  const tied = await finishRun(fixture, run);
  assert.equal(tied.run.score, 20);
  assert.equal(tied.run.status, 'lost');
  assert.equal(tied.player.runsPlayed, 3);
  assert.equal(tied.player.runsLost, 2);
  assert.equal(tied.player.bestScore, 20);
  assert.equal(tied.player.bestPizzaCount, 3);
  assert.equal(tied.player.totalPizzasCompleted, 7);
});

test('the exact deadline rejects the final cut and reconciles all expired runs exactly once', async (t) => {
  const fixture = await setup(t);
  const first = await addPlayer(fixture, 'First');
  const second = await addPlayer(fixture, 'Second');
  let run = await newRun(fixture, first.id, 'deadline-one');
  const otherRun = await newRun(fixture, second.id, 'deadline-two');
  run = (await completePizza(fixture, run, 1000)).run;
  fixture.setTime(run.endsAt - 1);
  for (let index = 0; index < run.currentPizza.requiredCuts - 1; index += 1) {
    assert.equal((await cut(fixture, run, `before-deadline-${index}`, stroke(run.currentPizza.guideAngles[index]))).status, 200);
  }
  fixture.setTime(run.endsAt);
  const last = await cut(fixture, run, 'at-deadline', stroke(run.currentPizza.guideAngles.at(-1)));
  assert.equal(last.body.run.status, 'won');
  assert.equal(last.body.run.score, 10);
  assert.equal(last.body.run.pizzasCompleted, 1);
  assert.equal(last.body.run.elapsedMs, 60000);
  assert.equal(last.body.run.currentPizza.currentSlices, 6);
  for (let index = 0; index < 2; index += 1) {
    const players = (await fixture.request('/api/players')).body;
    assert.equal(players.find((saved) => saved.id === first.id).runsWon, 1);
    assert.equal(players.find((saved) => saved.id === second.id).runsLost, 1);
    assert.ok(players.every((saved) => saved.runsPlayed === 1));
  }
  const other = await fixture.request(`/api/runs/${otherRun.id}`);
  assert.equal(other.body.run.status, 'lost');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.ok(state.runs.every((saved) => saved.recorded && saved.finishedAt === saved.endsAt));
});

test('new pizzas gain difficulty at twenty and forty seconds without changing a pizza already on screen', async (t) => {
  const fixture = await setup(t, { randomSequence: [0.4, 0, 0] });
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'difficulty-run');
  assert.equal(run.currentPizza.pizzaSize, 10);
  assert.equal(run.currentPizza.difficultyLevel, 1);
  run = (await completePizza(fixture, run, 19999)).run;
  const previousPizza = run.currentPizza;
  fixture.setTime(run.startsAt + 20000);
  const boundary = await fixture.request(`/api/runs/${run.id}`);
  assert.deepEqual(boundary.body.run.currentPizza, previousPizza);
  assert.equal(boundary.body.run.currentPizza.angleToleranceDeg, 10);
  run = (await completePizza(fixture, run, 20000)).run;
  assert.equal(run.currentPizza.difficultyLevel, 2);
  assert.equal(run.currentPizza.angleToleranceDeg, 8);
  assert.equal(run.currentPizza.pizzaSize, 14);
  fixture.setRandom([0.6, 0, 0.99, 0, 0]);
  run = (await completePizza(fixture, run, 40000)).run;
  assert.equal(run.currentPizza.difficultyLevel, 3);
  assert.equal(run.currentPizza.angleToleranceDeg, 6);
  assert.equal(run.currentPizza.pizzaSize, 14);
  assert.equal(run.currentPizza.grenade.appearsAt, run.startsAt + 40000);
  assert.equal(run.currentPizza.grenade.disappearsAt - run.currentPizza.grenade.appearsAt, 2200);
  assert.equal(run.score, 30);
  assert.deepEqual(run.pizzaCountsBySize, { '8': 0, '10': 2, '14': 1 });
  const persisted = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(persisted.status, 200);
  assert.deepEqual(persisted.body.run.currentPizza, run.currentPizza);
});

test('start aliases resume one run and cut IDs cannot apply twice or move to another action or run', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const other = await addPlayer(fixture, 'Other');
  const run = await newRun(fixture, player.id, 'original-start');
  for (const requestId of ['original-start', 'resume-start', 'resume-start']) {
    const retry = await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.run.id, run.id);
  }
  assert.equal(fixture.getRandomCalls(), 3);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: other.id, requestId: 'resume-start' })).status, 409);
  fixture.setTime(run.startsAt + 500);
  assert.equal((await cut(fixture, run, 'original-start', stroke(0))).status, 409);
  const firstCut = await cut(fixture, run, 'stable-cut-id', stroke(0));
  const changedBody = await cut(fixture, run, 'stable-cut-id', unevenStroke, 'different-pizza-id');
  assert.deepEqual(changedBody.body.run.currentPizza, firstCut.body.run.currentPizza);
  assert.equal(changedBody.body.run.pizzasSpoiled, 0);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'stable-cut-id' })).status, 409);
  await completePizza(fixture, firstCut.body.run, 1000);
  await finishRun(fixture, run);
  for (const requestId of ['original-start', 'resume-start']) {
    const retry = await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.run.id, run.id);
    assert.equal(retry.body.run.status, 'won');
    assert.equal(retry.body.player.runsPlayed, 1);
  }
  const next = await newRun(fixture, player.id, 'next-run');
  assert.notEqual(next.id, run.id);
  assert.equal(next.bestBefore, 10);
  assert.equal((await cut(fixture, next, 'stable-cut-id', stroke(0))).status, 409);
  const terminalRetry = await cut(fixture, run, 'stable-cut-id', unevenStroke);
  assert.equal(terminalRetry.body.run.score, 10);
  assert.equal(terminalRetry.body.player.runsPlayed, 1);
});

test('strict JSON validation rejects client scores, times, selected pizzas and malformed cut coordinates', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  for (const body of [{}, null, [], { playerId: player.id }, { playerId: player.id, requestId: ' ' },
    { playerId: player.id, requestId: 'r'.repeat(101) }, { playerId: player.id, requestId: 'size', pizzaSize: 8 },
    { playerId: player.id, requestId: 'score', bestScore: 0 }, { playerId: player.id, requestId: 'win', outcome: 'won' }]) {
    assert.equal((await fixture.request('/api/runs', 'POST', body)).status, 400);
  }
  const run = await newRun(fixture, player.id, 'validation-run');
  const original = await readFile(fixture.dataFile, 'utf8');
  const valid = { requestId: 'valid-cut', pizzaId: run.currentPizza.id, ...stroke(0) };
  const invalidCuts = [
    null, [], {}, { requestId: 'missing-pizza', ...stroke(0) }, { ...valid, elapsedMs: 1 },
    { ...valid, score: 1000 }, { ...valid, outcome: 'won' }, { ...valid, grenade: null },
    { ...valid, requestId: 5 }, { ...valid, requestId: '' }, { ...valid, pizzaId: [] },
    { ...valid, pizzaId: 'x'.repeat(101) }, { ...valid, start: { x: 1 } },
    { ...valid, start: { x: 1, y: 0, z: 0 } }, { ...valid, start: { x: '1', y: 0 } },
    { ...valid, end: { x: null, y: 0 } }, { ...valid, end: { x: 3.01, y: 0 } }
  ];
  for (const body of invalidCuts) {
    const response = await fixture.request(`/api/runs/${run.id}/cuts`, 'POST', body);
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
  }
  assert.equal(await readFile(fixture.dataFile, 'utf8'), original);
  const invalidJson = await fetch(fixture.base + '/api/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken'
  });
  assert.equal(invalidJson.status, 400);
  await invalidJson.text();
  const oversized = await fetch(fixture.base + '/api/runs', { method: 'POST', body: ' '.repeat(8193) });
  assert.equal(oversized.status, 413);
  await oversized.text();
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: 'missing', requestId: 'missing-player' })).status, 404);
  assert.equal((await fixture.request('/api/runs/missing')).status, 404);
  assert.equal((await fixture.request('/api/runs/missing/cuts', 'POST', valid)).status, 404);
  assert.equal((await fixture.request('/api/players', 'PUT', {})).status, 405);
  assert.equal((await fixture.request('/api/runs')).status, 405);
  assert.equal((await fixture.request(`/api/runs/${run.id}`, 'POST', {})).status, 405);
  const wrongMethod = await fixture.request(`/api/runs/${run.id}/cuts`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
});

test('parallel creates, starts, final cuts and result reads keep one coherent transaction history', async (t) => {
  const fixture = await setup(t);
  const players = await Promise.all(Array.from({ length: 8 }, (_, index) => addPlayer(fixture, `Player ${index + 1}`)));
  assert.equal((await fixture.request('/api/players')).body.length, 8);
  const starts = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    fixture.request('/api/runs', 'POST', { playerId: players[0].id, requestId: `parallel-start-${index}` })
  ));
  assert.equal(starts.filter((response) => response.status === 201).length, 1);
  assert.ok(starts.every((response) => response.status === 200 || response.status === 201));
  assert.equal(new Set(starts.map((response) => response.body.run.id)).size, 1);
  const run = starts[0].body.run;
  fixture.setTime(run.startsAt + 250);
  const pizza = run.currentPizza;
  const earlyCuts = await Promise.all(pizza.guideAngles.slice(0, -1).map((angle, index) =>
    cut(fixture, run, `parallel-cut-${index}`, stroke(angle))));
  assert.ok(earlyCuts.every((response) => response.status === 200));
  const finals = await Promise.all([
    cut(fixture, run, 'shared-final-cut', stroke(pizza.guideAngles.at(-1))),
    cut(fixture, run, 'shared-final-cut', stroke(pizza.guideAngles.at(-1))),
    cut(fixture, run, 'old-pizza-swipe', stroke(pizza.guideAngles[0]))
  ]);
  assert.ok(finals.every((response) => response.status === 200));
  const live = (await fixture.request(`/api/runs/${run.id}`)).body;
  assert.equal(live.run.status, 'playing');
  assert.equal(live.run.pizzasCompleted, 1);
  assert.equal(live.run.pizzasSpoiled, 0);
  assert.equal(live.run.score, 10);
  assert.deepEqual(live.run.currentPizza.completedCuts, []);
  assert.equal(live.player.runsPlayed, 0);
  fixture.setTime(run.endsAt);
  const results = await Promise.all(Array.from({ length: 4 }, () => fixture.request(`/api/runs/${run.id}`)));
  assert.ok(results.every((response) => response.body.player.runsPlayed === 1 && response.body.player.bestScore === 10));
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].startRequestIds.length, 8);
  assert.equal(state.runs[0].cutRequestIds.length, 5);
  assert.equal(state.players.find((saved) => saved.id === players[0].id).totalPizzasCompleted, 1);
});

test('restart preserves pizza, grenade, score, retry IDs and the original deadline while new runs use new preparation rules', async (t) => {
  const fixture = await setup(t, { randomSequence: [0.4, 0.25, 0.99, 0, 0] });
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'restart-start');
  run = (await completePizza(fixture, run, 1600)).run;
  const cutBeforeRestart = await cut(fixture, run, 'before-restart-cut', stroke(run.currentPizza.guideAngles[1]));
  run = cutBeforeRestart.body.run;
  assert.deepEqual(run.currentPizza.completedCuts, [1]);
  const newRules = { ...fixture.rules, preparationMs: 0 };
  await writeFile(join(fixture.publicDir, 'game-rules.json'), JSON.stringify(newRules));
  assert.deepEqual(await (await fetch(fixture.base + '/game-rules.json')).json(), fixture.rules);
  await close(fixture.server);
  const restarted = await fixture.start();
  const live = { ...fixture, ...restarted };
  assert.deepEqual(await (await fetch(live.base + '/game-rules.json')).json(), newRules);
  const loaded = await live.request(`/api/runs/${run.id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.run.endsAt, run.endsAt);
  assert.equal(loaded.body.run.score, 10);
  assert.deepEqual(loaded.body.run.currentPizza, run.currentPizza);
  const retry = await cut(live, run, 'before-restart-cut', unevenStroke);
  assert.deepEqual(retry.body.run.currentPizza, run.currentPizza);
  run = (await completePizza(live, run, run.currentPizza.grenade.disappearsAt - run.startsAt)).run;
  const finished = await finishRun(live, run);
  assert.equal(finished.run.status, 'won');
  assert.equal(finished.player.bestScore, 20);
  assert.equal(finished.player.totalPizzasCompleted, 2);
  const startRetry = await live.request('/api/runs', 'POST', { playerId: player.id, requestId: 'restart-start' });
  assert.equal(startRetry.body.run.id, run.id);
  assert.equal(startRetry.body.player.runsPlayed, 1);
  const next = await newRun(live, player.id, 'new-rules-run');
  assert.equal(next.endsAt - next.startsAt, 60000);
  assert.equal(next.status, 'playing');
  const stored = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(stored.runs.find((saved) => saved.id === run.id).rulesSnapshot.preparationMs, 3000);
  assert.equal(stored.runs.find((saved) => saved.id === next.id).rulesSnapshot.preparationMs, 0);
  fixture.setTime(next.endsAt);
  await close(restarted.server);
  const finalServer = await fixture.start();
  const finalPlayers = (await finalServer.request('/api/players')).body;
  assert.equal(finalPlayers[0].runsPlayed, 2);
  assert.equal(finalPlayers[0].runsWon, 1);
  assert.equal(finalPlayers[0].runsLost, 1);
  assert.equal(finalPlayers[0].bestScore, 20);
  assert.equal(finalPlayers[0].totalPizzasCompleted, 2);
  assert.equal((await finalServer.request('/api/players')).body[0].runsPlayed, 2);
});

test('a failed deadline save preserves the old file and retry records score, pizzas and verdict once', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'failed-save-run');
  run = (await completePizza(fixture, run, 1000)).run;
  const original = await readFile(fixture.dataFile, 'utf8');
  const dataDirectory = dirname(fixture.dataFile);
  const backupDirectory = join(fixture.directory, 'saved-data-backup');
  fixture.setTime(run.endsAt);
  // After reading the data, make the real save destination unavailable.
  fixture.onNextClock(() => {
    renameSync(dataDirectory, backupDirectory);
    writeFileSync(dataDirectory, 'A file temporarily blocks this directory.');
  });
  const failed = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /could not be saved/);
  assert.equal(await readFile(join(backupDirectory, 'rush.json'), 'utf8'), original);
  await rm(dataDirectory);
  await rename(backupDirectory, dataDirectory);
  const retried = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.run.status, 'won');
  assert.equal(retried.body.player.runsPlayed, 1);
  assert.equal(retried.body.player.runsWon, 1);
  assert.equal(retried.body.player.bestScore, 10);
  assert.equal(retried.body.player.totalPizzasCompleted, 1);
  assert.equal((await fixture.request('/api/players')).body[0].runsPlayed, 1);
});

test('a rejected name mutation still settles elapsed runs without keeping partial changes', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const other = await addPlayer(fixture, 'Other');
  const run = await newRun(fixture, player.id, 'rejected-mutation-run');
  fixture.setTime(run.endsAt);
  const rejected = await fixture.request(`/api/players/${other.id}`, 'PATCH', { name: player.name });
  assert.equal(rejected.status, 409);
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.players.find((saved) => saved.id === other.id).name, 'Other');
  assert.equal(state.players.find((saved) => saved.id === player.id).runsLost, 1);
  assert.equal(state.runs[0].recorded, true);
  assert.equal((await fixture.request('/api/players')).body.find((saved) => saved.id === player.id).runsLost, 1);
});

test('history retains active runs and only the latest hundred finished runs without resetting records', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const runIds = [];
  for (let index = 0; index < 103; index += 1) {
    const run = await newRun(fixture, player.id, `history-start-${index}`);
    runIds.push(run.id);
    fixture.setTime(run.endsAt);
  }
  assert.equal((await fixture.request('/api/players')).body[0].runsLost, 103);
  const active = await newRun(fixture, player.id, 'history-active');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.runs.filter((run) => run.recorded).length, 100);
  assert.equal(state.runs.length, 101);
  assert.ok(state.runs.some((run) => run.id === active.id && run.status === 'countdown'));
  assert.equal((await fixture.request(`/api/runs/${runIds[0]}`)).status, 404);
  const recentRetry = await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'history-start-102' });
  assert.equal(recentRetry.body.run.id, runIds[102]);
  assert.equal(recentRetry.body.player.runsPlayed, 103);
});

test('the two-thousand-ID cap keeps known retries and still allows the deadline to settle', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const run = await newRun(fixture, player.id, 'capped-start');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  state.runs[0].cutRequestIds = Array.from({ length: 1999 }, (_, index) => `old-ignored-cut-${index}`);
  await writeFile(fixture.dataFile, JSON.stringify(state));
  assert.equal((await cut(fixture, run, 'old-ignored-cut-0', stroke(0))).status, 200);
  assert.equal((await cut(fixture, run, 'one-too-many', stroke(0))).status, 429);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'new-alias-at-cap' })).status, 429);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'capped-start' })).status, 200);
  fixture.setTime(run.endsAt);
  const result = await cut(fixture, run, 'deadline-at-cap', stroke(0));
  assert.equal(result.status, 200);
  assert.equal(result.body.run.status, 'lost');
  assert.equal(result.body.player.runsPlayed, 1);
  const saved = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(saved.runs[0].cutRequestIds.length, 1999);
  assert.equal(saved.runs[0].recorded, true);
});

test('invalid saved scores, counters, pizza snapshots and rules are reported without erasing progress', async (t) => {
  const fixture = await setup(t, { randomSequence: [0, 0, 0.99, 0, 0] });
  const player = await addPlayer(fixture);
  await newRun(fixture, player.id, 'corruption-fixture');
  const valid = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  const mutations = [
    (state) => { state.players[0].bestScore = 'many'; },
    (state) => { state.players[0].runsPlayed = 1; },
    (state) => { state.runs[0].targetScore = 100; },
    (state) => { state.runs[0].score = 10; },
    (state) => { state.runs[0].pizzaCountsBySize['14'] = 1; },
    (state) => { state.runs[0].currentPizza.guideAngles[0] = 500; },
    (state) => { state.runs[0].currentPizza.completedCuts = [0, 1, 2, 3]; },
    (state) => { state.runs[0].currentPizza.grenade.radius = 0.2; },
    (state) => { state.runs[0].currentPizza.grenade.disappearsAt += 1; },
    (state) => { state.runs[0].currentPizza.difficultyLevel = 2; },
    (state) => { state.runs[0].rulesSnapshot.runDurationMs = 5000; },
    (state) => { state.players = []; },
    (state) => { state.runs.push({ ...structuredClone(state.runs[0]), id: 'second-run', requestId: 'second-start', startRequestIds: ['second-start'] }); },
    (state) => { state.runs[0].cutRequestIds = ['corruption-fixture']; }
  ];
  const corrupted = mutations.map((mutate) => {
    const state = structuredClone(valid);
    mutate(state);
    return JSON.stringify(state);
  });
  for (const text of ['{broken', '[]', '{"players":[],"rounds":[]}', ...corrupted]) {
    await writeFile(fixture.dataFile, text);
    assert.equal((await fixture.request('/api/players')).status, 500);
    assert.equal((await fixture.request('/api/players', 'POST', { name: 'New Player' })).status, 500);
    assert.equal(await readFile(fixture.dataFile, 'utf8'), text);
  }
  await writeFile(fixture.dataFile, JSON.stringify(valid));
  assert.equal((await fixture.request('/api/players')).status, 200);
  await writeFile(join(fixture.publicDir, 'game-rules.json'), '{}');
  await assert.rejects(createAppServer({ dataFile: fixture.dataFile, publicDir: fixture.publicDir }), /Game rules/);
  assert.deepEqual(JSON.parse(await readFile(fixture.dataFile, 'utf8')), valid);
});

test('only browser assets and explicit public views are exposed; request IDs and stored progress stay private', async (t) => {
  const fixture = await setup(t, { randomSequence: [0, 0, 0.99, 0, 0] });
  for (const filename of ['style.css', 'script.js', 'game.js']) {
    await writeFile(join(fixture.publicDir, filename), '/* public browser file */');
  }
  await writeFile(join(fixture.publicDir, 'server.js'), 'PRIVATE_SERVER_MARKER');
  await mkdir(join(fixture.publicDir, '.data'));
  await writeFile(join(fixture.publicDir, '.data', 'rush.json'), 'PRIVATE_DATA_MARKER');
  const player = await addPlayer(fixture);
  const run = await newRun(fixture, player.id, 'private-start-id');
  const response = await fixture.request(`/api/runs/${run.id}`);
  assertPublicRun(response.body.run);
  assertPublicPlayer(response.body.player);
  assert.doesNotMatch(JSON.stringify(response.body), /private-start-id|requestId|recorded|createdAt|finishedAt|rulesSnapshot|targetPizzas|bestTimesBySize/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const completed = await completePizza(fixture, run, 1600);
  assertPublicRun(completed.run);
  assertPublicPlayer(completed.player);
  assert.doesNotMatch(JSON.stringify(completed), /requestId|recorded|rulesSnapshot/);
  for (const path of ['/', '/index.html', '/style.css', '/script.js', '/game.js', '/game-rules.json']) {
    const file = await fetch(fixture.base + path);
    assert.equal(file.status, 200, path);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    await file.text();
  }
  const head = await fetch(fixture.base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const path of ['/server.js', '/.data/rush.json', '/.data/game.json', '/rush.json', '/package.json', '/.env',
    '/test/server.test.js', '/%2e%2e/server.js', '/%2e%2e%2f.data%2frush.json', '/api/config', '/api/rounds']) {
    const file = await fetch(fixture.base + path);
    assert.equal(file.status, 404, path);
    assert.doesNotMatch(await file.text(), /PRIVATE_|private-start-id/);
  }
});
