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
  const dataFile = join(directory, '.data', 'rush-3.1.json');
  const legacyDataFile = join(directory, '.data', 'rush.json');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><h1>Rush test</h1>');
  const rules = { ...JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8')), ...options.rules };
  await writeFile(join(publicDir, 'game-rules.json'), JSON.stringify(rules));
  if (options.legacy !== undefined || options.legacyText !== undefined) {
    await mkdir(dirname(dataFile), { recursive: true });
    await writeFile(legacyDataFile, options.legacyText ?? JSON.stringify(options.legacy));
  }
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
    directory, publicDir, dataFile, legacyDataFile, rules, start,
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

function stroke(pizza, angle = 0) {
  const radians = angle * Math.PI / 180;
  const dx = Math.cos(radians) * pizza.radius * 1.05;
  const dy = Math.sin(radians) * pizza.radius * 1.05;
  return { start: { x: pizza.x - dx, y: pizza.y - dy }, end: { x: pizza.x + dx, y: pizza.y + dy } };
}

function unevenStroke(pizza) {
  return { start: { x: pizza.x - pizza.radius * 1.05, y: pizza.y + pizza.radius * 0.3 },
    end: { x: pizza.x + pizza.radius * 1.05, y: pizza.y + pizza.radius * 0.3 } };
}

function grenadeStroke(grenade, halfLength = 2) {
  return { start: { x: grenade.x - halfLength, y: grenade.y }, end: { x: grenade.x + halfLength, y: grenade.y } };
}

function legacyProfile(id = 'old-player', name = 'Adzan', bestScore = 80) {
  return { id, name, runsPlayed: 3, runsWon: 1, runsLost: 2,
    bestScore, bestPizzaCount: 8, totalPizzasCompleted: 10 };
}

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

async function cut(fixture, run, requestId, coordinates, waveId = run.waveId) {
  return fixture.request(`/api/runs/${run.id}/cuts`, 'POST', { requestId, waveId, ...coordinates });
}

async function atWave(fixture, run, index) {
  fixture.setTime(run.startsAt + index * 5000);
  const response = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.run;
}

async function completePizza(fixture, run, pizza = run.pizzas[0], angle = 23) {
  const anchor = pizza.cutAngles[0] ?? angle;
  let response;
  for (let index = 0; index < pizza.requiredCuts; index += 1) {
    const desired = (anchor + index * 180 / pizza.requiredCuts) % 180;
    if (pizza.cutAngles.some((made) => Math.abs(made - desired) < 1e-7)) continue;
    response = await cut(fixture, run, `${pizza.id}-cut-${index}`, stroke(pizza, desired));
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  assert.equal(response.body.run.status, 'playing');
  assert.equal(response.body.run.pizzasCompleted, run.pizzasCompleted + 1);
  assert.ok(!response.body.run.pizzas.some((remaining) => remaining.id === pizza.id));
  assert.ok(response.body.run.lastEvents.some((event) => event.outcome === 'completed' && event.pizza.id === pizza.id));
  return response.body.run;
}

async function clearWave(fixture, run) {
  fixture.setTime(run.waveStartsAt + 2000);
  while (run.pizzas.length) run = await completePizza(fixture, run);
  return run;
}

async function finishRun(fixture, run) {
  fixture.setTime(run.endsAt);
  const response = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

function assertPublicPlayer(player) {
  assert.deepEqual(Object.keys(player).sort(), ['id', 'name', 'runsPlayed', 'runsWon', 'runsLost',
    'bestScore', 'bestPizzaCount', 'totalPizzasCompleted', 'previousBestScore'].sort());
}

function assertPublicPizza(pizza) {
  assert.deepEqual(Object.keys(pizza).sort(), ['id', 'pizzaSize', 'requiredSlices', 'requiredCuts',
    'x', 'y', 'radius', 'cutAngles', 'currentSlices', 'grenade'].sort());
}

function assertPublicRun(run) {
  assert.deepEqual(Object.keys(run).sort(), ['id', 'playerId', 'status', 'reason', 'startsAt', 'endsAt',
    'serverTime', 'remainingMs', 'countdownMs', 'elapsedMs', 'bestBefore', 'targetScore', 'score',
    'pizzasCompleted', 'pizzasSpoiled', 'grenadesHit', 'pizzasMissed', 'pizzaCountsBySize', 'waveIndex',
    'waveId', 'waveStartsAt', 'waveEndsAt', 'difficultyLevel', 'pizzas', 'lastEvents'].sort());
  run.pizzas.forEach(assertPublicPizza);
  for (const event of run.lastEvents) {
    assert.deepEqual(Object.keys(event).sort(), ['id', 'outcome', 'pizza']);
    assertPublicPizza(event.pizza);
  }
}

test('legacy profiles import once with fresh records; CRUD persists and leaves the old file untouched', async (t) => {
  const legacy = { players: [legacyProfile(), legacyProfile('other-id', 'Alia', 50)], runs: [{ oldRun: 'kept in the old file' }] };
  const fixture = await setup(t, { legacy });
  const oldText = await readFile(fixture.legacyDataFile, 'utf8');
  await assert.rejects(readFile(fixture.dataFile), { code: 'ENOENT' });
  const imported = await fixture.request('/api/players');
  assert.equal(imported.status, 200);
  assert.equal(imported.body.length, 2);
  assertPublicPlayer(imported.body[0]);
  assert.deepEqual(imported.body[0], { id: 'old-player', name: 'Adzan', runsPlayed: 0, runsWon: 0,
    runsLost: 0, bestScore: 0, bestPizzaCount: 0, totalPizzasCompleted: 0, previousBestScore: 80 });
  assert.deepEqual(JSON.parse(await readFile(fixture.dataFile, 'utf8')).runs, []);
  assert.equal((await fixture.request('/api/players', 'POST', { name: ' ADZAN ' })).status, 409);
  const fresh = await addPlayer(fixture, '  Fresh  ');
  assert.equal(fresh.name, 'Fresh');
  assert.equal(fresh.previousBestScore, null);
  for (const body of [{ name: '' }, { name: ' ' }, { name: 'x'.repeat(25) }, { name: 12 }, { name: 'Test', bestScore: 500 }]) {
    assert.equal((await fixture.request('/api/players', 'POST', body)).status, 400);
  }
  assert.equal((await fixture.request('/api/players/other-id', 'PATCH', { name: 'Fresh' })).status, 409);
  assert.equal((await fixture.request('/api/players/other-id', 'PATCH', { name: 'Renamed' })).status, 200);
  const run = await newRun(fixture, 'old-player', 'imported-start');
  assert.equal(run.bestBefore, 0);
  assert.equal(run.targetScore, 1);
  assert.equal((await fixture.request('/api/players/old-player', 'DELETE')).status, 204);
  assert.equal((await fixture.request(`/api/runs/${run.id}`)).status, 404);
  await close(fixture.server);
  const restarted = await fixture.start();
  const saved = (await restarted.request('/api/players')).body;
  assert.deepEqual(saved.map((player) => player.name).sort(), ['Fresh', 'Renamed']);
  assert.equal(saved.find((player) => player.id === 'other-id').previousBestScore, 50);
  assert.equal(await readFile(fixture.legacyDataFile, 'utf8'), oldText);
});

test('the first cut chooses the angle, clearing a batch waits for its schedule, and the minute continues', async (t) => {
  const fixture = await setup(t, { randomSequence: [0.5, 0] });
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'scheduled-run');
  assertPublicRun(run);
  assert.equal(run.countdownMs, 3000);
  assert.equal(run.remainingMs, 60000);
  assert.equal(run.pizzas[0].pizzaSize, 12);
  assert.equal(run.pizzas[0].radius, 36);
  assert.deepEqual(run.pizzas[0].cutAngles, []);
  const early = await cut(fixture, run, 'before-go', stroke(run.pizzas[0], 23));
  assert.equal(early.body.run.status, 'countdown');
  assert.deepEqual(early.body.run.pizzas[0].cutAngles, []);
  fixture.setTime(run.startsAt);
  const first = await cut(fixture, run, 'arbitrary-first-angle', stroke(run.pizzas[0], 23));
  assert.equal(first.body.run.status, 'playing');
  assert.ok(Math.abs(first.body.run.pizzas[0].cutAngles[0] - 23) < 1e-7);
  run = await completePizza(fixture, first.body.run);
  assert.equal(run.score, 10);
  assert.deepEqual(run.pizzas, []);
  const firstWaveId = run.waveId;
  fixture.setTime(run.waveEndsAt - 1);
  const waiting = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(waiting.body.run.status, 'playing');
  assert.equal(waiting.body.run.waveId, firstWaveId);
  assert.deepEqual(waiting.body.run.pizzas, []);
  const next = await atWave(fixture, run, 1);
  assert.equal(next.waveIndex, 1);
  assert.notEqual(next.waveId, firstWaveId);
  assert.equal(next.pizzas.length, 1);
  assert.equal(next.endsAt, run.endsAt);
  assert.equal(next.score, 10);
  const final = await finishRun(fixture, next);
  assert.equal(final.run.elapsedMs, 60000);
  assert.equal(final.run.pizzasCompleted, 1);
  assert.equal(final.run.pizzasMissed, 23);
  assert.equal(final.run.score, 0);
  assert.equal(final.run.status, 'lost');
  assert.equal(final.player.runsPlayed, 1);
  assert.equal(final.player.bestPizzaCount, 1);
});

test('one world-space swipe cuts multiple pizzas; later batches grow to two and three correctly scaled pizzas', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'multi-target-run');
  run = await atWave(fixture, run, 4);
  assert.equal(run.difficultyLevel, 2);
  assert.equal(run.pizzasMissed, 4);
  assert.deepEqual(run.pizzas.map(({ x, y }) => [x, y]), [[-70, 0], [70, 0]]);
  const acrossBoth = { start: { x: -180, y: 0 }, end: { x: 180, y: 0 } };
  const first = await cut(fixture, run, 'both-first-cuts', acrossBoth);
  assert.ok(first.body.run.pizzas.every((pizza) => pizza.cutAngles.length === 1 && pizza.currentSlices === 2));
  const right = first.body.run.pizzas[1];
  const leftDone = await cut(fixture, run, 'left-finished', stroke(run.pizzas[0], 90));
  assert.equal(leftDone.body.run.score, 10);
  assert.deepEqual(leftDone.body.run.pizzas, [right]);
  const duplicate = await cut(fixture, leftDone.body.run, 'duplicate-diameter', acrossBoth);
  assert.deepEqual(duplicate.body.run.pizzas, [right]);
  assert.deepEqual(duplicate.body.run.lastEvents, leftDone.body.run.lastEvents);
  const rightDone = await cut(fixture, duplicate.body.run, 'right-finished', stroke(right, 90));
  assert.equal(rightDone.body.run.score, 20);
  assert.deepEqual(rightDone.body.run.pizzas, []);
  run = await atWave(fixture, rightDone.body.run, 7);
  fixture.setRandom([0, 0, 0.4, 0, 0.9, 0]);
  run = await atWave(fixture, run, 8);
  assert.equal(run.difficultyLevel, 3);
  assert.deepEqual(run.pizzas.map(({ pizzaSize, requiredSlices, radius }) => [pizzaSize, requiredSlices, radius]),
    [[10, 4, 30], [12, 6, 36], [14, 8, 42]]);
  assert.deepEqual(run.pizzas.map(({ x, y }) => [x, y]), [[-70, -50], [70, -50], [0, 65]]);
});

test('exact batch and run deadlines precede cuts, catch up missed batches, and record the final score once', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'deadline-run');
  fixture.setTime(run.waveEndsAt - 1);
  await cut(fixture, run, 'before-wave-deadline', stroke(run.pizzas[0], 0));
  fixture.setTime(run.waveEndsAt);
  const expired = await cut(fixture, run, 'at-wave-deadline', stroke(run.pizzas[0], 90));
  assert.equal(expired.body.run.waveIndex, 1);
  assert.equal(expired.body.run.pizzasCompleted, 0);
  assert.equal(expired.body.run.pizzasMissed, 1);
  assert.deepEqual(expired.body.run.pizzas[0].cutAngles, []);
  const retry = await cut(fixture, expired.body.run, 'at-wave-deadline', stroke(expired.body.run.pizzas[0], 0));
  assert.deepEqual(retry.body.run.pizzas[0].cutAngles, []);
  run = await atWave(fixture, expired.body.run, 11);
  assert.equal(run.pizzasMissed, 21);
  fixture.setTime(run.endsAt - 1);
  run = await completePizza(fixture, run);
  run = await completePizza(fixture, run);
  const partial = await cut(fixture, run, 'last-pizza-first-cut', stroke(run.pizzas[0], 0));
  fixture.setTime(run.endsAt);
  const final = await cut(fixture, partial.body.run, 'at-run-deadline', stroke(run.pizzas[0], 90));
  assert.equal(final.body.run.status, 'won');
  assert.equal(final.body.run.reason, 'personal_best');
  assert.equal(final.body.run.score, 15);
  assert.equal(final.body.run.pizzasCompleted, 2);
  assert.equal(final.body.run.pizzasMissed, 22);
  assert.equal(final.body.run.waveIndex, 11);
  assert.deepEqual(final.body.run.pizzas, []);
  assert.equal(final.body.run.lastEvents[0].outcome, 'missed');
  assert.equal(final.body.player.bestScore, 15);
  assert.equal(final.body.player.runsWon, 1);
  const again = await finishRun(fixture, run);
  assert.equal(again.player.runsPlayed, 1);
  assert.equal(again.run.score, 15);
});

test('grenades and wrong cuts have separate penalties, with safe countdown, expiry, stale-wave and tiny gestures', async (t) => {
  const fixture = await setup(t, { randomSequence: [0, 0.99, 0] });
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'hazard-run');
  const originalWave = run.waveId;
  let grenade = run.pizzas[0].grenade;
  assert.equal(grenade.radius, 6);
  assert.equal(grenade.disappearsAt - grenade.appearsAt, 1800);
  assert.equal((await cut(fixture, run, 'countdown-hazard', grenadeStroke(grenade))).body.run.grenadesHit, 0);
  fixture.setTime(run.startsAt);
  assert.equal((await cut(fixture, run, 'tiny-hazard', grenadeStroke(grenade, 1))).body.run.grenadesHit, 0);
  const hit = await cut(fixture, run, 'first-hazard', grenadeStroke(grenade));
  assert.equal(hit.body.run.grenadesHit, 1);
  assert.equal(hit.body.run.pizzasSpoiled, 0);
  assert.equal(hit.body.run.score, 0);
  assert.deepEqual(hit.body.run.pizzas, []);
  run = await atWave(fixture, hit.body.run, 1);
  grenade = run.pizzas[0].grenade;
  const stale = await cut(fixture, run, 'stale-wave-hazard', grenadeStroke(grenade), originalWave);
  assert.equal(stale.body.run.grenadesHit, 1);
  assert.equal(stale.body.run.pizzas.length, 1);
  fixture.setTime(grenade.disappearsAt);
  run = await completePizza(fixture, run, run.pizzas[0], 0);
  assert.equal(run.score, 10);
  run = await atWave(fixture, run, 2);
  const wrong = await cut(fixture, run, 'wrong-chord', unevenStroke(run.pizzas[0]));
  assert.equal(wrong.body.run.score, 5);
  assert.equal(wrong.body.run.pizzasSpoiled, 1);
  assert.equal(wrong.body.run.grenadesHit, 1);
  run = await atWave(fixture, wrong.body.run, 3);
  const secondHit = await cut(fixture, run, 'second-hazard', grenadeStroke(run.pizzas[0].grenade));
  assert.equal(secondHit.body.run.score, 0);
  assert.equal(secondHit.body.run.grenadesHit, 2);
  assert.equal(secondHit.body.run.pizzasSpoiled, 1);
  const retry = await cut(fixture, run, 'second-hazard', unevenStroke(run.pizzas[0]));
  assert.equal(retry.body.run.grenadesHit, 2);
});

test('current score and pizza records remain independent and use only Version 3.1 results', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'first-record');
  run = await clearWave(fixture, await atWave(fixture, run, 11));
  const first = await finishRun(fixture, run);
  assert.equal(first.player.bestScore, 30);
  assert.equal(first.player.bestPizzaCount, 3);
  assert.equal(first.player.runsWon, 1);
  run = await newRun(fixture, player.id, 'more-pizzas-lower-score');
  assert.equal(run.bestBefore, 30);
  assert.equal(run.targetScore, 31);
  for (const index of [9, 10]) {
    run = await atWave(fixture, run, index);
    run = await completePizza(fixture, run);
  }
  run = await atWave(fixture, run, 11);
  run = await completePizza(fixture, run);
  run = await completePizza(fixture, run);
  run = (await cut(fixture, run, 'last-spoiled', unevenStroke(run.pizzas[0]))).body.run;
  const second = await finishRun(fixture, run);
  assert.equal(second.run.score, 15);
  assert.equal(second.run.pizzasCompleted, 4);
  assert.equal(second.run.status, 'lost');
  assert.equal(second.player.bestScore, 30);
  assert.equal(second.player.bestPizzaCount, 4);
  assert.equal(second.player.totalPizzasCompleted, 7);
  assert.equal(second.player.runsPlayed, 2);
});

test('parallel requests, retained start aliases and repeated final cuts keep one consistent saved result', async (t) => {
  const fixture = await setup(t);
  const players = await Promise.all(Array.from({ length: 4 }, (_, index) => addPlayer(fixture, `Player ${index}`)));
  const starts = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    fixture.request('/api/runs', 'POST', { playerId: players[0].id, requestId: `start-${index}` })));
  assert.equal(starts.filter((response) => response.status === 201).length, 1);
  assert.equal(new Set(starts.map((response) => response.body.run.id)).size, 1);
  const run = starts[0].body.run;
  fixture.setTime(run.startsAt);
  await cut(fixture, run, 'first-cut', stroke(run.pizzas[0], 0));
  const finals = await Promise.all(Array.from({ length: 3 }, () => cut(fixture, run, 'shared-final', stroke(run.pizzas[0], 90))));
  assert.ok(finals.every((response) => response.status === 200 && response.body.run.score === 10));
  const changed = await cut(fixture, run, 'shared-final', unevenStroke(run.pizzas[0]), 'changed-wave');
  assert.equal(changed.body.run.pizzasCompleted, 1);
  assert.equal(changed.body.run.pizzasSpoiled, 0);
  assert.equal((await cut(fixture, run, 'start-0', stroke(run.pizzas[0]))).status, 409);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: players[0].id, requestId: 'first-cut' })).status, 409);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: players[1].id, requestId: 'start-1' })).status, 409);
  await finishRun(fixture, run);
  const next = await newRun(fixture, players[0].id, 'next-start');
  assert.equal((await cut(fixture, next, 'first-cut', stroke(next.pizzas[0]))).status, 409);
  for (const requestId of ['start-0', 'start-1']) {
    const retry = await fixture.request('/api/runs', 'POST', { playerId: players[0].id, requestId });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.run.id, run.id);
    assert.equal(retry.body.player.runsPlayed, 1);
  }
  assert.equal((await fixture.request('/api/players')).body.length, 4);
});

test('strict request schemas protect scores and previous records and accept only world-space wave cuts', async (t) => {
  const fixture = await setup(t);
  assert.deepEqual((await fixture.request('/api/players')).body, []);
  const player = await addPlayer(fixture);
  for (const body of [{ bestScore: 10 }, { previousBestScore: 100 }, { name: 'A', runsWon: 1 }, { completedRoundId: 'old' }]) {
    assert.equal((await fixture.request(`/api/players/${player.id}`, 'PATCH', body)).status, 400);
  }
  for (const body of [null, {}, { playerId: player.id, requestId: ' ' }, { playerId: player.id, requestId: 'r'.repeat(101) },
    { playerId: player.id, requestId: 'extra', pizzaSize: 10 }]) {
    assert.equal((await fixture.request('/api/runs', 'POST', body)).status, 400);
  }
  const run = await newRun(fixture, player.id, 'validation-start');
  const original = await readFile(fixture.dataFile, 'utf8');
  const valid = { requestId: 'valid-cut', waveId: run.waveId, ...stroke(run.pizzas[0]) };
  for (const body of [null, {}, { ...valid, waveId: [] }, { ...valid, requestId: 5 }, { ...valid, waveId: '' },
    { requestId: 'old-pizza-cut', pizzaId: run.pizzas[0].id, ...stroke(run.pizzas[0]) },
    { ...valid, score: 100 }, { ...valid, elapsedMs: 1 }, { ...valid, outcome: 'won' },
    { ...valid, start: { x: '1', y: 0 } }, { ...valid, start: { x: 0, y: 0, z: 0 } },
    { ...valid, end: { x: 200.01, y: 0 } }, { ...valid, end: { x: null, y: 0 } }]) {
    const response = await fixture.request(`/api/runs/${run.id}/cuts`, 'POST', body);
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
  }
  assert.equal(await readFile(fixture.dataFile, 'utf8'), original);
  for (const [body, expected] of [['{broken', 400], [' '.repeat(8193), 413]]) {
    const response = await fetch(fixture.base + '/api/runs', { method: 'POST', body });
    assert.equal(response.status, expected);
    await response.text();
  }
  assert.equal((await fixture.request('/api/runs/missing')).status, 404);
  assert.equal((await fixture.request('/api/runs/missing/cuts', 'POST', valid)).status, 404);
  assert.equal((await fixture.request('/api/runs')).status, 405);
  assert.equal((await fixture.request(`/api/runs/${run.id}/cuts`)).headers.get('allow'), 'POST');
});

test('restart preserves wave timestamps, confirmed cuts and grenades while new runs use updated preparation rules', async (t) => {
  const fixture = await setup(t, { randomSequence: [0.4, 0.99, 0.25] });
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'restart-start');
  run = await clearWave(fixture, run);
  run = await atWave(fixture, run, 4);
  fixture.setTime(run.waveStartsAt + 1800);
  run = (await cut(fixture, run, 'before-restart-cut', stroke(run.pizzas[0], 17))).body.run;
  const newRules = { ...fixture.rules, preparationMs: 0 };
  await writeFile(join(fixture.publicDir, 'game-rules.json'), JSON.stringify(newRules));
  assert.deepEqual(await (await fetch(fixture.base + '/game-rules.json')).json(), fixture.rules);
  await close(fixture.server);
  const restarted = await fixture.start();
  const live = { ...fixture, ...restarted };
  const loaded = await live.request(`/api/runs/${run.id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.run.endsAt, run.endsAt);
  assert.equal(loaded.body.run.waveId, run.waveId);
  assert.deepEqual(loaded.body.run.pizzas, run.pizzas);
  const retry = await cut(live, run, 'before-restart-cut', unevenStroke(run.pizzas[0]));
  assert.deepEqual(retry.body.run.pizzas, run.pizzas);
  assert.deepEqual(await (await fetch(live.base + '/game-rules.json')).json(), newRules);
  run = await clearWave(live, await atWave(live, run, 11));
  const final = await finishRun(live, run);
  assert.equal(final.player.bestScore, 30);
  assert.equal(final.player.totalPizzasCompleted, 4);
  const next = await newRun(live, player.id, 'new-rules-run');
  assert.equal(next.status, 'playing');
  const stored = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(stored.runs.find((saved) => saved.id === run.id).rulesSnapshot.preparationMs, 3000);
  assert.equal(stored.runs.find((saved) => saved.id === next.id).rulesSnapshot.preparationMs, 0);
  fixture.setTime(next.endsAt);
  await close(restarted.server);
  const finalServer = await fixture.start();
  const saved = (await finalServer.request('/api/players')).body[0];
  assert.equal(saved.runsPlayed, 2);
  assert.equal(saved.runsWon, 1);
  assert.equal(saved.runsLost, 1);
  assert.equal(saved.bestScore, 30);
  assert.equal((await finalServer.request('/api/players')).body[0].runsPlayed, 2);
});

test('failed deadline writes roll back missed penalties and statistics so retry records them exactly once', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'failed-save');
  run = await atWave(fixture, run, 11);
  run = await completePizza(fixture, run);
  run = await completePizza(fixture, run);
  const original = await readFile(fixture.dataFile, 'utf8');
  const dataDirectory = dirname(fixture.dataFile);
  const backup = join(fixture.directory, 'saved-backup');
  fixture.setTime(run.endsAt);
  fixture.onNextClock(() => {
    renameSync(dataDirectory, backup);
    writeFileSync(dataDirectory, 'Temporarily block the save directory.');
  });
  const failed = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /could not be saved/);
  assert.equal(await readFile(join(backup, 'rush-3.1.json'), 'utf8'), original);
  await rm(dataDirectory);
  await rename(backup, dataDirectory);
  const retried = await finishRun(fixture, run);
  assert.equal(retried.run.score, 15);
  assert.equal(retried.run.pizzasMissed, 22);
  assert.equal(retried.player.runsWon, 1);
  assert.equal(retried.player.totalPizzasCompleted, 2);
  assert.equal((await finishRun(fixture, run)).player.runsPlayed, 1);
});

test('history retains every active run and only the latest hundred finished runs without resetting totals', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let firstId;
  for (let index = 0; index < 102; index += 1) {
    const run = await newRun(fixture, player.id, `history-${index}`);
    firstId ??= run.id;
    fixture.setTime(run.endsAt);
  }
  assert.equal((await fixture.request('/api/players')).body[0].runsLost, 102);
  const active = await newRun(fixture, player.id, 'active-after-history');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.runs.filter((run) => run.recorded).length, 100);
  assert.equal(state.runs.length, 101);
  assert.ok(state.runs.some((run) => run.id === active.id));
  assert.equal((await fixture.request(`/api/runs/${firstId}`)).status, 404);
  const retry = await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'history-101' });
  assert.equal(retry.body.player.runsPlayed, 102);
});

test('the request cap preserves retries and still reconciles batch expiry and the final deadline', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const run = await newRun(fixture, player.id, 'capped-start');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  state.runs[0].cutRequestIds = Array.from({ length: 1999 }, (_, index) => `old-cut-${index}`);
  await writeFile(fixture.dataFile, JSON.stringify(state));
  assert.equal((await cut(fixture, run, 'old-cut-0', stroke(run.pizzas[0]))).status, 200);
  fixture.setTime(run.waveEndsAt);
  assert.equal((await cut(fixture, run, 'too-many', stroke(run.pizzas[0]))).status, 429);
  const wave = await fixture.request(`/api/runs/${run.id}`);
  assert.equal(wave.body.run.waveIndex, 1);
  assert.equal(wave.body.run.pizzasMissed, 1);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'new-alias' })).status, 429);
  assert.equal((await fixture.request('/api/runs', 'POST', { playerId: player.id, requestId: 'capped-start' })).status, 200);
  fixture.setTime(run.endsAt);
  const final = await cut(fixture, run, 'final-at-cap', stroke(run.pizzas[0]));
  assert.equal(final.status, 200);
  assert.equal(final.body.run.pizzasMissed, 24);
  assert.equal(final.body.player.runsPlayed, 1);
});

test('invalid stored wave, pizza, event and record data is reported without overwriting it', async (t) => {
  const fixture = await setup(t, { randomSequence: [0, 0.99, 0] });
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'corrupt-fixture');
  run = await clearWave(fixture, run);
  await atWave(fixture, run, 1);
  const valid = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  const mutations = [
    (state) => { state.players[0].previousBestScore = -1; },
    (state) => { state.players[0].runsPlayed = 1; },
    (state) => { state.runs[0].waveStartsAt += 1; },
    (state) => { state.runs[0].eventSerial += 1; },
    (state) => { state.runs[0].pizzas[0].radius = 99; },
    (state) => { state.runs[0].pizzas[0].anchorAngle = 60; },
    (state) => { state.runs[0].pizzas[0].grenade.disappearsAt += 1; },
    (state) => { state.runs[0].lastEvents[0].pizza.anchorAngle = null; },
    (state) => { state.runs[0].rulesSnapshot.mode = 'arcade-3.0'; }
  ];
  const corrupted = mutations.map((mutate) => { const state = structuredClone(valid); mutate(state); return JSON.stringify(state); });
  for (const text of ['{broken', '[]', ...corrupted]) {
    await writeFile(fixture.dataFile, text);
    assert.equal((await fixture.request('/api/players')).status, 500);
    assert.equal((await fixture.request('/api/players', 'POST', { name: 'Extra' })).status, 500);
    assert.equal(await readFile(fixture.dataFile, 'utf8'), text);
  }
  await writeFile(fixture.dataFile, JSON.stringify(valid));
  assert.equal((await fixture.request('/api/players')).status, 200);
  await writeFile(join(fixture.publicDir, 'game-rules.json'), '{}');
  await assert.rejects(createAppServer({ dataFile: fixture.dataFile, publicDir: fixture.publicDir }), /Game rules/);
  assert.deepEqual(JSON.parse(await readFile(fixture.dataFile, 'utf8')), valid);
});

test('corrupt legacy profiles fail safely and never create a replacement store', async (t) => {
  const fixture = await setup(t, { legacyText: '{broken' });
  const badProfile = { ...legacyProfile(), bestScore: 'many' };
  for (const text of ['{broken', '[]', JSON.stringify({ players: [badProfile], runs: [] }),
    JSON.stringify({ players: [legacyProfile(), legacyProfile()], runs: [] })]) {
    await writeFile(fixture.legacyDataFile, text);
    const response = await fixture.request('/api/players');
    assert.equal(response.status, 500);
    assert.match(response.body.error, /Previous progress/);
    assert.equal(await readFile(fixture.legacyDataFile, 'utf8'), text);
    await assert.rejects(readFile(fixture.dataFile), { code: 'ENOENT' });
  }
  await writeFile(fixture.legacyDataFile, JSON.stringify({ players: [legacyProfile()], runs: [] }));
  assert.equal((await fixture.request('/api/players')).body[0].previousBestScore, 80);
});

test('public responses expose confirmed cuts only and the static allowlist protects both data versions', async (t) => {
  const fixture = await setup(t);
  for (const filename of ['style.css', 'script.js', 'game.js']) await writeFile(join(fixture.publicDir, filename), '/* public */');
  await writeFile(join(fixture.publicDir, 'server.js'), 'PRIVATE_SERVER_MARKER');
  const player = await addPlayer(fixture);
  let run = await newRun(fixture, player.id, 'private-start-id');
  run = await clearWave(fixture, run);
  const response = await fixture.request(`/api/runs/${run.id}`);
  assertPublicRun(response.body.run);
  assertPublicPlayer(response.body.player);
  assert.doesNotMatch(JSON.stringify(response.body), /private-start-id|requestId|recorded|rulesSnapshot|anchorAngle|guideAngles|completedCuts|eventSerial/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const path of ['/', '/index.html', '/style.css', '/script.js', '/game.js', '/game-rules.json']) {
    const response = await fetch(fixture.base + path);
    assert.equal(response.status, 200);
    await response.text();
  }
  for (const path of ['/server.js', '/.data/rush-3.1.json', '/.data/rush.json', '/.data/game.json',
    '/package.json', '/test/server.test.js', '/%2e%2e%2f.data%2frush-3.1.json', '/api/config', '/api/rounds']) {
    const response = await fetch(fixture.base + path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /PRIVATE_|private-start-id/);
  }
});
