import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createAppServer } from '../server.js';

// Real HTTP requests use temporary files, an unused local port, and a controlled clock.
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pizza-slice-test-'));
  const publicDir = join(directory, 'public');
  const dataFile = join(directory, '.data', 'game.json');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><h1>Slice test</h1>');
  const rules = { ...JSON.parse(await readFile(new URL('../game-rules.json', import.meta.url), 'utf8')), ...options.rules };
  await writeFile(join(publicDir, 'game-rules.json'), JSON.stringify(rules));
  let now = 1_000_000;
  let nextClockHook = null;
  let randomSequence = options.randomSequence || [0, 0];
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
    advance(milliseconds) { now += milliseconds; },
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

async function addPlayer(fixture, name = 'Adzan') {
  const response = await fixture.request('/api/players', 'POST', { name });
  assert.equal(response.status, 201);
  return response.body;
}

async function newRound(fixture, playerId, requestId) {
  const response = await fixture.request('/api/rounds', 'POST', { playerId, requestId });
  assert.equal(response.status, 201);
  return response.body.round;
}

async function cut(fixture, round, requestId, coordinates) {
  return fixture.request(`/api/rounds/${round.id}/cuts`, 'POST', { requestId, ...coordinates });
}

async function winRound(fixture, round, elapsedMs, prefix = round.id) {
  fixture.setTime(round.startsAt + elapsedMs);
  let response;
  for (let index = 0; index < round.requiredCuts; index += 1) {
    response = await cut(fixture, round, `${prefix}-cut-${index}`, stroke(round.guideAngles[index]));
    assert.equal(response.status, 200);
  }
  assert.equal(response.body.round.status, 'won');
  return response.body;
}

function assertPublicPlayer(player) {
  assert.deepEqual(Object.keys(player).sort(), ['bestTimesBySize', 'id', 'name', 'roundsLost', 'roundsWon']);
  assert.deepEqual(Object.keys(player.bestTimesBySize).sort(), ['10', '14', '8']);
}

function assertPublicRound(round) {
  assert.deepEqual(Object.keys(round).sort(), [
    'completedCuts', 'countdownMs', 'currentSlices', 'elapsedMs', 'endsAt', 'guideAngles', 'id',
    'pizzaSize', 'playerId', 'reason', 'remainingMs', 'requiredCuts', 'requiredSlices', 'serverTime',
    'startsAt', 'status'
  ]);
}

test('player CRUD is strict, keeps names unique, and deletes associated rounds atomically', async (t) => {
  const fixture = await setup(t);
  const initial = await fixture.request('/api/players');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, []);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const player = await addPlayer(fixture, '  Adzan  ');
  assertPublicPlayer(player);
  assert.equal(player.name, 'Adzan');
  assert.equal(player.roundsWon, 0);
  assert.equal(player.roundsLost, 0);
  assert.deepEqual(player.bestTimesBySize, { '8': null, '10': null, '14': null });
  assert.equal((await fixture.request('/api/players', 'POST', { name: 'ADZAN' })).status, 409);
  const other = await addPlayer(fixture, 'Alia');
  assert.equal((await fixture.request(`/api/players/${other.id}`, 'PATCH', { name: ' adzan ' })).status, 409);
  const renamed = await fixture.request(`/api/players/${player.id}`, 'PATCH', { name: 'ADZAN' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.id, player.id);

  for (const body of [null, [], {}, { name: '' }, { name: '  ' }, { name: 12 }, { name: 'x'.repeat(25) },
    { name: 'Valid', roundsWon: 5 }]) {
    assert.equal((await fixture.request('/api/players', 'POST', body)).status, 400);
  }
  for (const body of [{ roundsWon: 10 }, { roundsLost: 0 }, { completedRoundId: 'old-client' },
    { roundResult: { outcome: 'won', elapsedMs: 1 } }, { bestTimesBySize: { '14': 1 } }]) {
    assert.equal((await fixture.request(`/api/players/${player.id}`, 'PATCH', body)).status, 400);
  }
  const round = await newRound(fixture, player.id, 'crud-round');
  assert.equal((await fixture.request(`/api/players/${player.id}`, 'DELETE')).status, 204);
  assert.equal((await fixture.request(`/api/rounds/${round.id}`)).status, 404);
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.players.length, 1);
  assert.equal(state.rounds.length, 0);
  assert.equal((await fixture.request(`/api/players/${player.id}`, 'DELETE')).status, 404);
});

test('the server chooses a random pizza and rotation, waits for Go, and returns its own winning verdict', async (t) => {
  const fixture = await setup(t, { randomSequence: [0.4, 0.25] });
  const player = await addPlayer(fixture);
  const round = await newRound(fixture, player.id, 'server-chosen-round');
  assertPublicRound(round);
  assert.equal(round.pizzaSize, 10);
  assert.equal(round.requiredSlices, 6);
  assert.equal(round.requiredCuts, 3);
  assert.deepEqual(round.guideAngles, [45, 105, 165]);
  assert.equal(round.status, 'countdown');
  assert.equal(round.countdownMs, 3000);
  assert.equal(round.remainingMs, 20000);
  assert.equal(round.endsAt - round.startsAt, 20000);

  const early = await cut(fixture, round, 'early-cut', stroke(round.guideAngles[0]));
  assert.equal(early.status, 200);
  assert.deepEqual(early.body.round.completedCuts, []);
  fixture.setTime(round.startsAt);
  const ready = await fixture.request(`/api/rounds/${round.id}`);
  assert.equal(ready.body.round.status, 'playing');
  assert.equal(ready.body.round.countdownMs, 0);
  const earlyRetry = await cut(fixture, round, 'early-cut', stroke(round.guideAngles[1]));
  assert.deepEqual(earlyRetry.body.round.completedCuts, []);

  const result = await winRound(fixture, round, 1200);
  assert.equal(result.round.reason, 'correct_slices');
  assert.equal(result.round.currentSlices, 6);
  assert.equal(result.round.elapsedMs, 1200);
  assert.equal(result.player.roundsWon, 1);
  assert.equal(result.player.roundsLost, 0);
  assert.deepEqual(result.player.bestTimesBySize, { '8': null, '10': 1200, '14': null });
  assert.equal(typeof result.feedback, 'string');
  const retry = await cut(fixture, round, 'late-extra-cut', stroke(0));
  assert.deepEqual(retry.body.player, result.player);
  assert.equal(retry.body.round.status, 'won');
  assert.equal(retry.body.round.elapsedMs, 1200);
  assert.deepEqual((await fixture.request('/api/players')).body, [result.player]);
});

test('start IDs and active-round aliases survive settlement without creating a second round', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const other = await addPlayer(fixture, 'Lyla');
  const round = await newRound(fixture, player.id, 'original-start');
  for (const requestId of ['original-start', 'resume-start']) {
    const response = await fixture.request('/api/rounds', 'POST', { playerId: player.id, requestId });
    assert.equal(response.status, 200);
    assert.equal(response.body.round.id, round.id);
  }
  assert.equal(fixture.getRandomCalls(), 2);
  assert.equal((await fixture.request('/api/rounds', 'POST', { playerId: other.id, requestId: 'resume-start' })).status, 409);
  fixture.setTime(round.endsAt);
  const expired = await fixture.request(`/api/rounds/${round.id}`);
  assert.equal(expired.body.player.roundsLost, 1);
  for (const requestId of ['original-start', 'resume-start']) {
    const retry = await fixture.request('/api/rounds', 'POST', { playerId: player.id, requestId });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.round.id, round.id);
    assert.equal(retry.body.round.status, 'lost');
    assert.equal(retry.body.player.roundsLost, 1);
  }
  assert.equal(fixture.getRandomCalls(), 2);
  const next = await newRound(fixture, player.id, 'new-round-after-loss');
  assert.notEqual(next.id, round.id);
  assert.equal(fixture.getRandomCalls(), 4);
});

test('incomplete and outside swipes do nothing; duplicate guides do nothing; a wrong full cut loses', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const round = await newRound(fixture, player.id, 'cut-types');
  fixture.setTime(round.startsAt + 500);
  const ignoredStrokes = [
    { start: { x: 0, y: 0 }, end: { x: 0.2, y: 0.2 } },
    { start: { x: -2, y: -2 }, end: { x: 2, y: 2 } },
    { start: { x: -0.7, y: 1.1 }, end: { x: 0.7, y: 1.1 } }
  ];
  for (let index = 0; index < ignoredStrokes.length; index += 1) {
    const ignored = await cut(fixture, round, `ignored-${index}`, ignoredStrokes[index]);
    assert.equal(ignored.status, 200);
    assert.equal(ignored.body.round.status, 'playing');
    assert.deepEqual(ignored.body.round.completedCuts, []);
  }
  const accepted = await cut(fixture, round, 'accepted-guide', stroke(round.guideAngles[0]));
  assert.equal(accepted.body.round.currentSlices, 2);
  const duplicate = await cut(fixture, round, 'same-guide-new-id', stroke(round.guideAngles[0] + 180));
  assert.deepEqual(duplicate.body.round.completedCuts, accepted.body.round.completedCuts);
  const changedRetry = await cut(fixture, round, 'accepted-guide', stroke(round.guideAngles[1]));
  assert.deepEqual(changedRetry.body.round.completedCuts, accepted.body.round.completedCuts);

  const wrong = await cut(fixture, round, 'wrong-full-cut', {
    start: { x: -1, y: 0.3 }, end: { x: 1, y: 0.3 }
  });
  assert.equal(wrong.body.round.status, 'lost');
  assert.equal(wrong.body.round.reason, 'wrong_cut');
  assert.equal(wrong.body.round.elapsedMs, 500);
  assert.equal(wrong.body.player.roundsLost, 1);
  assert.equal(wrong.body.player.roundsWon, 0);
  const replay = await cut(fixture, round, 'wrong-full-cut', stroke(round.guideAngles[1]));
  assert.equal(replay.body.round.reason, 'wrong_cut');
  assert.equal(replay.body.player.roundsLost, 1);
});

test('a cut exactly at the server deadline loses and reads reconcile every expired player once', async (t) => {
  const fixture = await setup(t);
  const first = await addPlayer(fixture, 'First');
  const second = await addPlayer(fixture, 'Second');
  const round = await newRound(fixture, first.id, 'deadline-one');
  const otherRound = await newRound(fixture, second.id, 'deadline-two');
  fixture.setTime(round.endsAt - 1);
  for (let index = 0; index < round.requiredCuts - 1; index += 1) {
    assert.equal((await cut(fixture, round, `before-deadline-${index}`, stroke(round.guideAngles[index]))).body.round.status, 'playing');
  }
  fixture.setTime(round.endsAt);
  const last = await cut(fixture, round, 'at-deadline', stroke(round.guideAngles.at(-1)));
  assert.equal(last.body.round.status, 'lost');
  assert.equal(last.body.round.reason, 'timeout');
  assert.equal(last.body.round.elapsedMs, 20000);
  assert.equal(last.body.round.currentSlices, 6);
  for (let index = 0; index < 2; index += 1) {
    const players = (await fixture.request('/api/players')).body;
    assert.ok(players.every((player) => player.roundsLost === 1 && player.roundsWon === 0));
  }
  const other = await fixture.request(`/api/rounds/${otherRound.id}`);
  assert.equal(other.body.round.status, 'lost');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.ok(state.rounds.every((saved) => saved.recorded && saved.reason === 'timeout'));
});

test('best times remain separate for each size and only a faster win improves that size', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  let sequence = 0;
  async function playSize(size, elapsedMs) {
    const index = fixture.rules.pizzas.findIndex((pizza) => pizza.sizeInches === size);
    fixture.setRandom([(index + 0.1) / 3, 0.25]);
    const round = await newRound(fixture, player.id, `sized-round-${sequence++}`);
    assert.equal(round.pizzaSize, size);
    return winRound(fixture, round, elapsedMs);
  }
  await playSize(14, 4000);
  await playSize(10, 3000);
  const third = await playSize(8, 2000);
  assert.deepEqual(third.player.bestTimesBySize, { '8': 2000, '10': 3000, '14': 4000 });
  const slower = await playSize(14, 5000);
  assert.equal(slower.player.bestTimesBySize['14'], 4000);
  const faster = await playSize(14, 1000);
  assert.equal(faster.player.roundsWon, 5);
  assert.deepEqual(faster.player.bestTimesBySize, { '8': 2000, '10': 3000, '14': 1000 });
  fixture.setRandom([0.4, 0]);
  const lossRound = await newRound(fixture, player.id, 'size-loss');
  fixture.setTime(lossRound.startsAt + 200);
  const loss = await cut(fixture, lossRound, 'uneven-size-cut', stroke(lossRound.guideAngles[0] + 30));
  assert.equal(loss.body.round.status, 'lost');
  assert.equal(loss.body.player.roundsLost, 1);
  assert.deepEqual(loss.body.player.bestTimesBySize, faster.player.bestTimesBySize);
});

test('strict request validation rejects forged outcomes, selected sizes and malformed coordinates', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  for (const body of [{}, null, [], { playerId: player.id }, { playerId: player.id, requestId: ' ' },
    { playerId: player.id, requestId: 'r'.repeat(101) }, { playerId: player.id, requestId: 'size', pizzaSize: 8 },
    { playerId: player.id, requestId: 'outcome', outcome: 'won' }]) {
    assert.equal((await fixture.request('/api/rounds', 'POST', body)).status, 400);
  }
  const round = await newRound(fixture, player.id, 'validation-round');
  const original = await readFile(fixture.dataFile, 'utf8');
  const valid = { requestId: 'valid-cut', ...stroke(0) };
  const invalidCuts = [
    null, [], {}, { ...valid, elapsedMs: 1 }, { ...valid, outcome: 'won' },
    { ...valid, requestId: 5 }, { ...valid, requestId: '' },
    { ...valid, start: { x: 1 } }, { ...valid, start: { x: 1, y: 0, z: 0 } },
    { ...valid, start: { x: '1', y: 0 } }, { ...valid, end: { x: null, y: 0 } },
    { ...valid, end: { x: 3.01, y: 0 } }
  ];
  for (const body of invalidCuts) {
    assert.equal((await fixture.request(`/api/rounds/${round.id}/cuts`, 'POST', body)).status, 400);
  }
  assert.equal(await readFile(fixture.dataFile, 'utf8'), original);
  const invalidJson = await fetch(fixture.base + '/api/rounds', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken'
  });
  assert.equal(invalidJson.status, 400);
  await invalidJson.text();
  const oversized = await fetch(fixture.base + '/api/rounds', { method: 'POST', body: ' '.repeat(8193) });
  assert.equal(oversized.status, 413);
  await oversized.text();
  assert.equal((await fixture.request('/api/rounds', 'POST', { playerId: 'missing', requestId: 'missing-player' })).status, 404);
  assert.equal((await fixture.request('/api/rounds/missing')).status, 404);
  assert.equal((await fixture.request('/api/rounds/missing/cuts', 'POST', valid)).status, 404);
  assert.equal((await fixture.request('/api/players', 'PUT', {})).status, 405);
  assert.equal((await fixture.request('/api/rounds')).status, 405);
  assert.equal((await fixture.request(`/api/rounds/${round.id}`, 'POST', {})).status, 405);
  assert.equal((await fixture.request(`/api/rounds/${round.id}/cuts`)).status, 405);
});

test('concurrent creates, start requests and repeated cut requests keep one coherent saved state', async (t) => {
  const fixture = await setup(t);
  const players = await Promise.all(Array.from({ length: 8 }, (_, index) => addPlayer(fixture, `Player ${index + 1}`)));
  assert.equal((await fixture.request('/api/players')).body.length, 8);
  const starts = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    fixture.request('/api/rounds', 'POST', { playerId: players[0].id, requestId: `parallel-start-${index}` })
  ));
  assert.equal(starts.filter((response) => response.status === 201).length, 1);
  assert.ok(starts.every((response) => response.status === 200 || response.status === 201));
  assert.equal(new Set(starts.map((response) => response.body.round.id)).size, 1);
  const round = starts[0].body.round;
  fixture.setTime(round.startsAt + 250);
  const cuts = await Promise.all(Array.from({ length: 5 }, (_, index) =>
    cut(fixture, round, 'one-shared-cut-id', stroke(round.guideAngles[index % round.requiredCuts]))
  ));
  assert.ok(cuts.every((response) => response.status === 200 && response.body.round.completedCuts.length === 1));
  const completed = cuts.at(-1).body.round.completedCuts[0];
  const remaining = round.guideAngles.map((angle, index) => ({ angle, index })).filter((item) => item.index !== completed);
  const results = await Promise.all(remaining.map(({ angle, index }) => cut(fixture, round, `remaining-${index}`, stroke(angle))));
  assert.ok(results.every((response) => response.status === 200));
  const final = (await fixture.request(`/api/rounds/${round.id}`)).body;
  assert.equal(final.round.status, 'won');
  assert.equal(final.player.roundsWon, 1);
  assert.equal(final.player.bestTimesBySize['14'], 250);
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.rounds.length, 1);
  assert.equal(state.rounds[0].startRequestIds.length, 8);
  assert.equal(state.rounds[0].cutRequestIds.length, 4);
});

test('rounds, result IDs and statistics persist across restart; old rounds retain their rule snapshot', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const round = await newRound(fixture, player.id, 'restart-start');
  fixture.setTime(round.startsAt + 150);
  await cut(fixture, round, 'before-restart-cut', stroke(round.guideAngles[0]));
  await writeFile(join(fixture.publicDir, 'game-rules.json'), JSON.stringify({ ...fixture.rules, preparationMs: 0, roundDurationMs: 1000 }));
  const stillRunningRules = await fetch(fixture.base + '/game-rules.json');
  assert.deepEqual(await stillRunningRules.json(), fixture.rules);
  await close(fixture.server);
  const restarted = await fixture.start();
  const live = { ...fixture, ...restarted };
  const restartedRules = await fetch(live.base + '/game-rules.json');
  assert.equal((await restartedRules.json()).roundDurationMs, 1000);
  const loaded = await live.request(`/api/rounds/${round.id}`);
  assert.equal(loaded.body.round.endsAt, round.endsAt);
  assert.deepEqual(loaded.body.round.completedCuts, [0]);
  const retry = await cut(live, round, 'before-restart-cut', stroke(round.guideAngles[1]));
  assert.deepEqual(retry.body.round.completedCuts, [0]);
  fixture.setTime(round.startsAt + 1500);
  for (let index = 1; index < round.requiredCuts; index += 1) {
    assert.equal((await cut(live, round, `after-restart-${index}`, stroke(round.guideAngles[index]))).status, 200);
  }
  const finished = (await live.request(`/api/rounds/${round.id}`)).body;
  assert.equal(finished.round.status, 'won');
  assert.equal(finished.player.bestTimesBySize['14'], 1500);
  const startRetry = await live.request('/api/rounds', 'POST', { playerId: player.id, requestId: 'restart-start' });
  assert.equal(startRetry.body.round.id, round.id);
  assert.equal(startRetry.body.player.roundsWon, 1);
  const next = await newRound(live, player.id, 'new-rules-round');
  assert.equal(next.endsAt - next.startsAt, 1000);
  assert.equal(next.status, 'playing');
  assert.equal((await cut(live, next, 'before-restart-cut', stroke(next.guideAngles[0]))).status, 409);
  fixture.setTime(next.endsAt);
  await close(restarted.server);
  const finalServer = await fixture.start();
  const finalPlayers = (await finalServer.request('/api/players')).body;
  assert.equal(finalPlayers[0].roundsWon, 1);
  assert.equal(finalPlayers[0].roundsLost, 1);
  assert.equal(finalPlayers[0].bestTimesBySize['14'], 1500);
  assert.equal((await finalServer.request('/api/players')).body[0].roundsLost, 1);
});

test('a failed timeout save preserves the original file and a later retry records exactly one loss', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const round = await newRound(fixture, player.id, 'failed-save-round');
  const original = await readFile(fixture.dataFile, 'utf8');
  const dataDirectory = dirname(fixture.dataFile);
  const backupDirectory = join(fixture.directory, 'saved-data-backup');
  fixture.setTime(round.endsAt);
  // After reading the data, make the real save destination unavailable.
  fixture.onNextClock(() => {
    renameSync(dataDirectory, backupDirectory);
    writeFileSync(dataDirectory, 'A file temporarily blocks this directory.');
  });
  const failed = await fixture.request('/api/players');
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /could not be saved/);
  assert.equal(await readFile(join(backupDirectory, 'game.json'), 'utf8'), original);
  await rm(dataDirectory);
  await rename(backupDirectory, dataDirectory);
  const retried = await fixture.request(`/api/rounds/${round.id}`);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.round.status, 'lost');
  assert.equal(retried.body.player.roundsLost, 1);
  assert.equal((await fixture.request('/api/players')).body[0].roundsLost, 1);
});

test('history retains active rounds and at most 100 settled rounds without resetting cumulative results', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const roundIds = [];
  for (let index = 0; index < 103; index += 1) {
    const round = await newRound(fixture, player.id, `history-start-${index}`);
    roundIds.push(round.id);
    fixture.setTime(round.endsAt);
  }
  assert.equal((await fixture.request('/api/players')).body[0].roundsLost, 103);
  const active = await newRound(fixture, player.id, 'history-active');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  assert.equal(state.rounds.filter((round) => round.recorded).length, 100);
  assert.equal(state.rounds.length, 101);
  assert.ok(state.rounds.some((round) => round.id === active.id && round.status === 'countdown'));
  assert.equal((await fixture.request(`/api/rounds/${roundIds[0]}`)).status, 404);
  const recentRetry = await fixture.request('/api/rounds', 'POST', { playerId: player.id, requestId: 'history-start-102' });
  assert.equal(recentRetry.body.round.id, roundIds[102]);
  assert.equal(recentRetry.body.player.roundsLost, 103);
});

test('the per-round request cap preserves known retries and still permits deadline settlement', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  const round = await newRound(fixture, player.id, 'capped-start');
  const state = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  state.rounds[0].cutRequestIds = Array.from({ length: 499 }, (_, index) => `old-ignored-cut-${index}`);
  await writeFile(fixture.dataFile, JSON.stringify(state));
  assert.equal((await cut(fixture, round, 'old-ignored-cut-0', stroke(0))).status, 200);
  assert.equal((await cut(fixture, round, 'one-too-many', stroke(0))).status, 429);
  assert.equal((await fixture.request('/api/rounds', 'POST', { playerId: player.id, requestId: 'new-alias-at-cap' })).status, 429);
  assert.equal((await fixture.request('/api/rounds', 'POST', { playerId: player.id, requestId: 'capped-start' })).status, 200);
  fixture.setTime(round.endsAt);
  const result = await fixture.request(`/api/rounds/${round.id}`);
  assert.equal(result.body.round.status, 'lost');
  assert.equal(result.body.player.roundsLost, 1);
});

test('invalid saved progress and startup rules are reported without erasing progress', async (t) => {
  const fixture = await setup(t);
  const player = await addPlayer(fixture);
  await newRound(fixture, player.id, 'corruption-fixture');
  const valid = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
  const wrongStats = structuredClone(valid);
  wrongStats.players[0].roundsWon = 'many';
  const wrongRound = structuredClone(valid);
  wrongRound.rounds[0].guideAngles[0] = 500;
  const orphanRound = structuredClone(valid);
  orphanRound.players = [];
  const duplicateActive = structuredClone(valid);
  duplicateActive.rounds.push({ ...duplicateActive.rounds[0], id: 'second-round', requestId: 'second-start', startRequestIds: ['second-start'] });
  for (const text of ['{broken', '[]', JSON.stringify(wrongStats), JSON.stringify(wrongRound), JSON.stringify(orphanRound), JSON.stringify(duplicateActive)]) {
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

test('only browser files are public, while API views omit request IDs and internal result bookkeeping', async (t) => {
  const fixture = await setup(t);
  for (const filename of ['style.css', 'script.js', 'game.js']) {
    await writeFile(join(fixture.publicDir, filename), '/* public browser file */');
  }
  await writeFile(join(fixture.publicDir, 'server.js'), 'PRIVATE_SERVER_MARKER');
  await mkdir(join(fixture.publicDir, '.data'));
  await writeFile(join(fixture.publicDir, '.data', 'game.json'), 'PRIVATE_DATA_MARKER');
  const player = await addPlayer(fixture);
  const round = await newRound(fixture, player.id, 'private-start-id');
  const response = await fixture.request(`/api/rounds/${round.id}`);
  assertPublicRound(response.body.round);
  assertPublicPlayer(response.body.player);
  assert.doesNotMatch(JSON.stringify(response.body), /private-start-id|requestId|recorded|createdAt|finishedAt/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const path of ['/', '/index.html', '/style.css', '/script.js', '/game.js', '/game-rules.json']) {
    const file = await fetch(fixture.base + path);
    assert.equal(file.status, 200, path);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    await file.text();
  }
  const head = await fetch(fixture.base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const path of ['/server.js', '/.data/game.json', '/game.json', '/package.json', '/.env', '/test/server.test.js',
    '/%2e%2e/server.js', '/%2e%2e%2f.data%2fgame.json', '/api/config']) {
    const file = await fetch(fixture.base + path);
    assert.equal(file.status, 404, path);
    assert.doesNotMatch(await file.text(), /PRIVATE_|private-start-id/);
  }
});
