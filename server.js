// The server chooses the pizza, checks each cut, and records the result.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  validateRules, createRun, advanceRun, applyRunCut, toPublicRun,
  isRunOver, PIZZA_SLICES, SCORE_RULES, DIFFICULTY_LEVELS
} from './game.js';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const maximumBodyBytes = 8 * 1024;
const terminalHistoryLimit = 100;
const requestHistoryLimit = 2000;

// Only browser files and the shared game rules are public.
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']],
  ['/game-rules.json', ['game-rules.json', 'application/json; charset=utf-8']]
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(status === 204 ? undefined : JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= maximumBodyBytes) chunks.push(chunk);
    });
    request.on('end', () => {
      if (bytes > maximumBodyBytes) {
        rejectBody(new RequestError(413, 'That request is too large. Use 8 KB or less.'));
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectBody(new RequestError(400, 'Please send valid JSON.'));
      }
    });
    request.on('error', () => rejectBody(new RequestError(400, 'The request could not be read.')));
  });
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireKeys(value, keys, message) {
  if (!hasExactKeys(value, keys)) throw new RequestError(400, message);
}

function validId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 100 && value === value.trim();
}

function cleanId(value) {
  if (typeof value !== 'string' || !validId(value.trim())) {
    throw new RequestError(400, 'Use an ID from 1 to 100 characters.');
  }
  return value.trim();
}

function cleanName(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 24) {
    throw new RequestError(400, 'Enter a player name from 1 to 24 characters.');
  }
  return value.trim();
}

function cleanPoint(value) {
  requireKeys(value, ['x', 'y'], 'Each cut endpoint needs only x and y coordinates.');
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) ||
      Math.abs(value.x) > 3 || Math.abs(value.y) > 3) {
    throw new RequestError(400, 'Cut coordinates must be numbers between -3 and 3.');
  }
  return { x: value.x, y: value.y };
}

function publicPlayer(player) {
  return {
    id: player.id, name: player.name,
    runsPlayed: player.runsPlayed, runsWon: player.runsWon, runsLost: player.runsLost,
    bestScore: player.bestScore, bestPizzaCount: player.bestPizzaCount,
    totalPizzasCompleted: player.totalPizzasCompleted
  };
}

function checkUniqueName(players, name, currentId) {
  if (players.some((player) => player.id !== currentId && player.name.toLowerCase() === name.toLowerCase())) {
    throw new RequestError(409, 'That player name is already in use.');
  }
}

function validIdList(ids) {
  return Array.isArray(ids) && ids.every(validId) && new Set(ids).size === ids.length;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// Check saved snapshots without choosing new pizzas or resetting their difficulty.
function validSavedPizza(pizza, run, isLast = false) {
  if (!pizza || typeof pizza !== 'object' || Array.isArray(pizza) || !validId(pizza.id) ||
      !Number.isInteger(pizza.pizzaSize) || !Object.hasOwn(PIZZA_SLICES, pizza.pizzaSize) ||
      pizza.requiredSlices !== PIZZA_SLICES[pizza.pizzaSize] ||
      pizza.requiredCuts !== pizza.requiredSlices / 2) return false;
  if (!Array.isArray(pizza.guideAngles) || pizza.guideAngles.length !== pizza.requiredCuts ||
      !pizza.guideAngles.every((angle) => Number.isInteger(angle) && angle >= 0 && angle < 180) ||
      pizza.guideAngles[0] % 15 !== 0 || !pizza.guideAngles.every((angle, index) =>
        angle === (pizza.guideAngles[0] + index * 180 / pizza.requiredCuts) % 180)) return false;
  if (!Array.isArray(pizza.completedCuts) || new Set(pizza.completedCuts).size !== pizza.completedCuts.length ||
      !pizza.completedCuts.every((index) => Number.isInteger(index) && index >= 0 && index < pizza.requiredCuts)) return false;

  const level = DIFFICULTY_LEVELS.find((item) => item.level === pizza.difficultyLevel);
  if (!level || pizza.angleToleranceDeg !== level.angleToleranceDeg) return false;
  const grenade = pizza.grenade;
  if (grenade !== null) {
    if (!hasExactKeys(grenade, ['x', 'y', 'radius', 'appearsAt', 'disappearsAt']) ||
        !Number.isFinite(grenade.x) || !Number.isFinite(grenade.y) || grenade.radius !== 0.19 ||
        Math.abs(Math.hypot(grenade.x, grenade.y) - 0.70) > 1e-9 ||
        !validCount(grenade.appearsAt) || !validCount(grenade.disappearsAt) ||
        grenade.appearsAt < run.startsAt || grenade.appearsAt >= run.endsAt ||
        grenade.disappearsAt - grenade.appearsAt !== level.grenadeDurationMs) return false;
    if (!pizza.guideAngles.some((angle) => {
      const radians = angle * Math.PI / 180;
      return Math.abs(grenade.x * Math.sin(radians) - grenade.y * Math.cos(radians)) <= 1e-9;
    })) return false;
  }

  if (!isLast) {
    return !Object.hasOwn(pizza, 'outcome') && pizza.completedCuts.length < pizza.requiredCuts;
  }
  if (pizza.outcome === 'completed') return pizza.completedCuts.length === pizza.requiredCuts;
  if (pizza.outcome === 'spoiled') return pizza.completedCuts.length < pizza.requiredCuts;
  return pizza.outcome === 'grenade' && grenade !== null && pizza.completedCuts.length < pizza.requiredCuts;
}

function validSavedRun(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run) ||
      !validId(run.id) || !validId(run.playerId) || !validId(run.requestId)) return false;
  let snapshot;
  try { snapshot = validateRules(run.rulesSnapshot); }
  catch { return false; }
  if (![run.createdAt, run.startsAt, run.endsAt].every(validCount) ||
      run.startsAt - run.createdAt !== snapshot.preparationMs ||
      run.runDurationMs !== snapshot.runDurationMs ||
      run.endsAt - run.startsAt !== run.runDurationMs) return false;
  if (![run.bestBefore, run.targetScore, run.score, run.pizzasCompleted,
    run.pizzasSpoiled, run.grenadesHit].every(validCount) ||
      run.targetScore !== run.bestBefore + 1 ||
      run.score / SCORE_RULES.completedPizza > run.pizzasCompleted ||
      !hasExactKeys(run.pizzaCountsBySize, ['8', '10', '14']) ||
      !Object.values(run.pizzaCountsBySize).every(validCount) ||
      Object.values(run.pizzaCountsBySize).reduce((sum, count) => sum + count, 0) !== run.pizzasCompleted) return false;
  if (!validIdList(run.startRequestIds) || !run.startRequestIds.includes(run.requestId) ||
      !validIdList(run.cutRequestIds) ||
      run.startRequestIds.length + run.cutRequestIds.length > requestHistoryLimit ||
      typeof run.recorded !== 'boolean') return false;
  if (!validSavedPizza(run.currentPizza, run)) return false;
  const hasFinishedPizza = run.pizzasCompleted > 0 || run.pizzasSpoiled > 0 || run.grenadesHit > 0;
  if (hasFinishedPizza) {
    if (!validSavedPizza(run.lastPizza, run, true) || run.lastPizza.id === run.currentPizza.id) return false;
    if (run.lastPizza.outcome === 'completed' && run.pizzaCountsBySize[run.lastPizza.pizzaSize] === 0) return false;
    if (run.lastPizza.outcome === 'spoiled' && run.pizzasSpoiled === 0) return false;
    if (run.lastPizza.outcome === 'grenade' && run.grenadesHit === 0) return false;
  } else if (run.lastPizza !== null) return false;

  if (run.status === 'countdown' || run.status === 'playing') {
    return run.reason === null && run.elapsedMs === null && run.finishedAt === null &&
      !run.recorded && (run.status === 'playing' ||
        (!hasFinishedPizza && run.currentPizza.completedCuts.length === 0));
  }
  const won = run.score > run.bestBefore;
  return run.status === (won ? 'won' : 'lost') && run.reason === (won ? 'personal_best' : 'time_up') &&
    run.elapsedMs === run.runDurationMs && run.finishedAt === run.endsAt;
}

function validSavedState(state) {
  if (!hasExactKeys(state, ['players', 'runs']) || !Array.isArray(state.players) || !Array.isArray(state.runs)) return false;
  const playersById = new Map();
  const names = new Set();
  for (const player of state.players) {
    if (!hasExactKeys(player, ['id', 'name', 'runsPlayed', 'runsWon', 'runsLost',
      'bestScore', 'bestPizzaCount', 'totalPizzasCompleted']) ||
        !validId(player.id) || playersById.has(player.id) || typeof player.name !== 'string' ||
        !player.name || player.name.length > 24 || player.name !== player.name.trim() ||
        names.has(player.name.toLowerCase()) ||
        ![player.runsPlayed, player.runsWon, player.runsLost, player.bestScore,
          player.bestPizzaCount, player.totalPizzasCompleted].every(validCount) ||
        player.runsWon + player.runsLost !== player.runsPlayed ||
        player.bestPizzaCount > player.totalPizzasCompleted ||
        player.bestScore / SCORE_RULES.completedPizza > player.bestPizzaCount ||
        (player.runsPlayed === 0 && player.totalPizzasCompleted !== 0) ||
        (player.runsWon > 0 && player.bestScore === 0)) return false;
    playersById.set(player.id, player);
    names.add(player.name.toLowerCase());
  }

  const runIds = new Set();
  const requestIds = new Set();
  const activePlayers = new Set();
  const recordedCounts = new Map();
  for (const run of state.runs) {
    if (!validSavedRun(run) || runIds.has(run.id) || !playersById.has(run.playerId)) return false;
    runIds.add(run.id);
    for (const id of [...run.startRequestIds, ...run.cutRequestIds]) {
      if (requestIds.has(id)) return false;
      requestIds.add(id);
    }
    const player = playersById.get(run.playerId);
    if (run.bestBefore > player.bestScore) return false;
    if (!isRunOver(run)) {
      if (activePlayers.has(run.playerId)) return false;
      activePlayers.add(run.playerId);
    } else if (run.recorded) {
      const counts = recordedCounts.get(player.id) || { won: 0, lost: 0, pizzas: 0 };
      counts[run.status] += 1;
      counts.pizzas += run.pizzasCompleted;
      recordedCounts.set(player.id, counts);
      if (counts.won > player.runsWon || counts.lost > player.runsLost ||
          counts.pizzas > player.totalPizzasCompleted ||
          run.score > player.bestScore || run.pizzasCompleted > player.bestPizzaCount) return false;
    }
  }
  return true;
}

export async function createAppServer({
  dataFile = join(projectDirectory, '.data', 'rush.json'),
  publicDir = projectDirectory,
  clock = Date.now,
  random = Math.random
} = {}) {
  let rules;
  try {
    rules = validateRules(JSON.parse(await readFile(join(publicDir, 'game-rules.json'), 'utf8')));
  } catch {
    throw new RequestError(500, 'Game rules could not be read or are invalid. Check game-rules.json.');
  }
  if (typeof clock !== 'function' || typeof random !== 'function') {
    throw new Error('The server needs clock and random functions.');
  }

  // All API operations use one queue, including reads which may notice a timeout.
  let operationQueue = Promise.resolve();

  async function loadState() {
    let text;
    try {
      text = await readFile(dataFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { players: [], runs: [] };
      throw new RequestError(500, 'Saved progress could not be read. Please check the data file.');
    }
    try {
      const state = JSON.parse(text);
      if (!validSavedState(state)) throw new Error('Invalid saved progress');
      return state;
    } catch {
      throw new RequestError(500, 'Saved progress is invalid. The file has not been changed.');
    }
  }

  async function saveState(state) {
    const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(dataFile), { recursive: true });
      await writeFile(temporaryFile, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      // Players and runs replace the old file together, never half a result.
      await rename(temporaryFile, dataFile);
    } catch {
      await unlink(temporaryFile).catch(() => {});
      throw new RequestError(500, 'Your progress could not be saved. Please try again.');
    }
  }

  function recordResult(state, run) {
    if (!isRunOver(run) || run.recorded) return false;
    const player = state.players.find((item) => item.id === run.playerId);
    if (!Number.isSafeInteger(player.runsPlayed + 1) ||
        !Number.isSafeInteger(player.totalPizzasCompleted + run.pizzasCompleted)) {
      throw new RequestError(409, 'This player has reached the saved progress limit.');
    }
    player.runsPlayed += 1;
    if (run.status === 'won') {
      player.runsWon += 1;
    } else {
      player.runsLost += 1;
    }
    // Score and pizza records are independent: penalties can lower a run's score.
    player.bestScore = Math.max(player.bestScore, run.score);
    player.bestPizzaCount = Math.max(player.bestPizzaCount, run.pizzasCompleted);
    player.totalPizzasCompleted += run.pizzasCompleted;
    run.recorded = true;
    return true;
  }

  function reconcileRuns(state, nowMs) {
    let changed = false;
    state.runs = state.runs.map((run) => {
      const updated = advanceRun(run, nowMs);
      if (updated !== run) changed = true;
      if (recordResult(state, updated)) changed = true;
      return updated;
    });
    return changed;
  }

  function trimHistory(state) {
    const finished = state.runs.filter(isRunOver)
      .sort((first, second) => second.finishedAt - first.finishedAt);
    if (finished.length <= terminalHistoryLimit) return false;
    const keep = new Set(finished.slice(0, terminalHistoryLimit).map((run) => run.id));
    state.runs = state.runs.filter((run) => !isRunOver(run) || keep.has(run.id));
    return true;
  }

  function transact(operation) {
    const result = operationQueue.then(async () => {
      const saved = await loadState();
      const nowMs = clock();
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RequestError(500, 'The server clock is unavailable.');
      let reconciled = reconcileRuns(saved, nowMs);
      if (trimHistory(saved)) reconciled = true;
      // A rejected operation cannot partially change the reconciled data.
      const working = structuredClone(saved);
      let reply;
      try {
        reply = operation(working, nowMs);
      } catch (error) {
        if (reconciled) await saveState(saved);
        throw error;
      }
      let changed = reconciled || reply.changed;
      if (reconcileRuns(working, nowMs)) changed = true;
      if (trimHistory(working)) changed = true;
      if (changed) await saveState(working);
      return { status: reply.status, body: reply.body() };
    });
    // A failed save must not block future retries. Each retry reloads the file.
    operationQueue = result.catch(() => {});
    return result;
  }

  function findPlayer(state, id) {
    const player = state.players.find((item) => item.id === id);
    if (!player) throw new RequestError(404, 'That player could not be found.');
    return player;
  }

  function findRun(state, id) {
    const run = state.runs.find((item) => item.id === id);
    if (!run) throw new RequestError(404, 'That run could not be found. Reload players to continue.');
    return run;
  }

  function checkRequestCapacity(run) {
    if (run.startRequestIds.length + run.cutRequestIds.length >= requestHistoryLimit) {
      throw new RequestError(429, 'This run has received too many requests. Reload its current result.');
    }
  }

  function runFeedback(run) {
    if (run.status === 'won') return `New personal best: ${run.score} points!`;
    if (run.status === 'lost') return `Time's up! You scored ${run.score} points. Try again to beat your best.`;
    if (run.status === 'countdown') return 'Get ready. Wait for Go before cutting.';
    return 'Complete pizzas, follow the guides, and watch for grenades. Keep going until the minute ends.';
  }

  function envelope(state, run, nowMs, feedback = runFeedback(run)) {
    return { run: toPublicRun(run, nowMs), player: publicPlayer(findPlayer(state, run.playerId)), feedback };
  }

  function methodNotAllowed(response, methods) {
    response.setHeader('Allow', methods.join(', '));
    throw new RequestError(405, 'That method is not available for this address.');
  }

  function decodeId(value) {
    try { return cleanId(decodeURIComponent(value)); }
    catch { throw new RequestError(400, 'That resource address is invalid.'); }
  }

  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      let answer;
      if (pathname === '/api/players') {
        if (request.method === 'GET') {
          answer = await transact((state) => ({ status: 200, changed: false, body: () => state.players.map(publicPlayer) }));
        } else if (request.method === 'POST') {
          const body = await readJson(request);
          requireKeys(body, ['name'], 'Send only a player name.');
          const name = cleanName(body.name);
          answer = await transact((state) => {
            checkUniqueName(state.players, name);
            const player = {
              id: randomUUID(), name, runsPlayed: 0, runsWon: 0, runsLost: 0,
              bestScore: 0, bestPizzaCount: 0, totalPizzasCompleted: 0
            };
            state.players.push(player);
            return { status: 201, changed: true, body: () => publicPlayer(player) };
          });
        } else methodNotAllowed(response, ['GET', 'POST']);
      } else if (/^\/api\/players\/[^/]+$/.test(pathname)) {
        const id = decodeId(pathname.split('/')[3]);
        if (request.method === 'PATCH') {
          const body = await readJson(request);
          requireKeys(body, ['name'], 'Only a player name can be edited. Game results come from the server.');
          const name = cleanName(body.name);
          answer = await transact((state) => {
            const player = findPlayer(state, id);
            checkUniqueName(state.players, name, id);
            const changed = player.name !== name;
            player.name = name;
            return { status: 200, changed, body: () => publicPlayer(player) };
          });
        } else if (request.method === 'DELETE') {
          answer = await transact((state) => {
            findPlayer(state, id);
            state.players = state.players.filter((player) => player.id !== id);
            state.runs = state.runs.filter((run) => run.playerId !== id);
            return { status: 204, changed: true, body: () => null };
          });
        } else methodNotAllowed(response, ['PATCH', 'DELETE']);
      } else if (pathname === '/api/runs') {
        if (request.method !== 'POST') methodNotAllowed(response, ['POST']);
        const body = await readJson(request);
        requireKeys(body, ['playerId', 'requestId'], 'A new run needs only playerId and requestId.');
        const playerId = cleanId(body.playerId);
        const requestId = cleanId(body.requestId);
        answer = await transact((state, nowMs) => {
          if (state.runs.some((run) => run.cutRequestIds.includes(requestId))) {
            throw new RequestError(409, 'That request ID was already used for a cut.');
          }
          const previous = state.runs.find((run) => run.startRequestIds.includes(requestId));
          if (previous) {
            if (previous.playerId !== playerId) throw new RequestError(409, 'That start request ID belongs to another player.');
            return { status: 200, changed: false, body: () => envelope(state, previous, nowMs) };
          }
          const player = findPlayer(state, playerId);
          const active = state.runs.find((run) => run.playerId === playerId && !isRunOver(run));
          if (active) {
            checkRequestCapacity(active);
            active.startRequestIds.push(requestId);
            return { status: 200, changed: true, body: () => envelope(state, active, nowMs, 'Your current run has been resumed.') };
          }
          if (player.runsPlayed >= Number.MAX_SAFE_INTEGER || player.bestScore >= Number.MAX_SAFE_INTEGER) {
            throw new RequestError(409, 'This player has reached the saved progress limit.');
          }
          const run = createRun({ id: randomUUID(), playerId, requestId, bestScore: player.bestScore }, rules, nowMs, random, randomUUID);
          state.runs.push(run);
          return { status: 201, changed: true, body: () => envelope(state, run, nowMs) };
        });
      } else if (/^\/api\/runs\/[^/]+\/cuts$/.test(pathname)) {
        if (request.method !== 'POST') methodNotAllowed(response, ['POST']);
        const id = decodeId(pathname.split('/')[3]);
        const body = await readJson(request);
        requireKeys(body, ['requestId', 'pizzaId', 'start', 'end'], 'A cut needs only requestId, pizzaId, start and end.');
        const requestId = cleanId(body.requestId);
        const stroke = { pizzaId: cleanId(body.pizzaId), start: cleanPoint(body.start), end: cleanPoint(body.end) };
        answer = await transact((state, nowMs) => {
          const run = findRun(state, id);
          if (state.runs.some((item) => item.startRequestIds.includes(requestId))) {
            throw new RequestError(409, 'That request ID was already used to start a run.');
          }
          const previous = state.runs.find((item) => item.cutRequestIds.includes(requestId));
          if (previous && previous.id !== id) throw new RequestError(409, 'That cut request ID belongs to another run.');
          if (isRunOver(run)) {
            return { status: 200, changed: false, body: () => envelope(state, run, nowMs) };
          }
          if (previous) {
            return { status: 200, changed: false, body: () => envelope(state, run, nowMs, 'That cut request was already received.') };
          }
          checkRequestCapacity(run);
          const result = applyRunCut(run, stroke, nowMs, random, randomUUID);
          result.run.cutRequestIds.push(requestId);
          state.runs[state.runs.findIndex((item) => item.id === id)] = result.run;
          return { status: 200, changed: true, body: () => envelope(state, result.run, nowMs, result.feedback) };
        });
      } else if (/^\/api\/runs\/[^/]+$/.test(pathname)) {
        if (request.method !== 'GET') methodNotAllowed(response, ['GET']);
        const id = decodeId(pathname.split('/')[3]);
        answer = await transact((state, nowMs) => {
          const run = findRun(state, id);
          return { status: 200, changed: false, body: () => envelope(state, run, nowMs) };
        });
      } else {
        const browserFile = publicFiles.get(pathname);
        if (!browserFile) throw new RequestError(404, 'That page or resource could not be found.');
        if (request.method !== 'GET' && request.method !== 'HEAD') methodNotAllowed(response, ['GET', 'HEAD']);
        const [filename, contentType] = browserFile;
        let contents;
        try {
          // Serve the configuration actually used by this server instance.
          contents = filename === 'game-rules.json'
            ? Buffer.from(JSON.stringify(rules, null, 2) + '\n')
            : await readFile(join(publicDir, filename));
        }
        catch (error) {
          if (error.code === 'ENOENT') throw new RequestError(404, 'That file could not be found.');
          throw error;
        }
        response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': contents.length, 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : contents);
        return;
      }
      sendJson(response, answer.status, answer.body);
    } catch (error) {
      sendJson(response, error instanceof RequestError ? error.status : 500, {
        error: error instanceof RequestError ? error.message : 'The request could not be completed. Please try again.'
      });
    }
  });
}

// Importing this file does not start a server or modify saved progress.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const server = await createAppServer();
    const host = process.env.HOST || '127.0.0.1';
    server.listen(Number(process.env.PORT || 3000), host, () => {
      console.log(`Pizza Slice Rush Version 3 is running at http://${host}:${server.address().port}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
