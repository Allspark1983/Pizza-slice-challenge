// The server chooses the pizza, checks each cut, and records the result.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  validateRules, createRound, advanceRound, applyCut, toPublicRound,
  isRoundOver, PIZZA_SLICES
} from './game.js';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const maximumBodyBytes = 8 * 1024;
const terminalHistoryLimit = 100;
const requestHistoryLimit = 500;

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
    roundsWon: player.roundsWon, roundsLost: player.roundsLost,
    bestTimesBySize: { ...player.bestTimesBySize }
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

function validSavedRound(round) {
  if (!round || typeof round !== 'object' || Array.isArray(round) ||
      !validId(round.id) || !validId(round.playerId) || !validId(round.requestId)) return false;
  if (!Number.isInteger(round.pizzaSize) || !Object.hasOwn(PIZZA_SLICES, round.pizzaSize) ||
      round.requiredSlices !== PIZZA_SLICES[round.pizzaSize] ||
      round.requiredCuts !== round.requiredSlices / 2) return false;
  if (!Array.isArray(round.guideAngles) || round.guideAngles.length !== round.requiredCuts ||
      !round.guideAngles.every((angle) => Number.isInteger(angle) && angle >= 0 && angle < 180) ||
      round.guideAngles[0] % 15 !== 0 || !round.guideAngles.every((angle, index) =>
        angle === (round.guideAngles[0] + index * 180 / round.requiredCuts) % 180)) return false;
  if (!Array.isArray(round.completedCuts) || new Set(round.completedCuts).size !== round.completedCuts.length ||
      !round.completedCuts.every((index) => Number.isInteger(index) && index >= 0 && index < round.requiredCuts)) return false;
  if (![round.createdAt, round.startsAt, round.endsAt].every((time) => Number.isSafeInteger(time) && time >= 0) ||
      round.startsAt < round.createdAt || round.startsAt - round.createdAt > 10000 ||
      !Number.isSafeInteger(round.roundDurationMs) || round.roundDurationMs < 1000 || round.roundDurationMs > 120000 ||
      round.endsAt !== round.startsAt + round.roundDurationMs) return false;
  if (!validIdList(round.startRequestIds) || !round.startRequestIds.includes(round.requestId) ||
      !validIdList(round.cutRequestIds) ||
      round.startRequestIds.length + round.cutRequestIds.length > requestHistoryLimit ||
      typeof round.recorded !== 'boolean') return false;

  if (round.status === 'countdown' || round.status === 'playing') {
    return round.reason === null && round.elapsedMs === null && round.finishedAt === null &&
      !round.recorded && round.completedCuts.length < round.requiredCuts;
  }
  if (!isRoundOver(round) || !Number.isSafeInteger(round.elapsedMs) || round.elapsedMs < 1 ||
      !Number.isSafeInteger(round.finishedAt)) return false;
  if (round.status === 'won') {
    if (round.reason !== 'correct_slices' || round.completedCuts.length !== round.requiredCuts) return false;
  } else if (!['wrong_cut', 'timeout'].includes(round.reason) || round.completedCuts.length >= round.requiredCuts) {
    return false;
  }
  if (round.reason === 'timeout') {
    return round.elapsedMs === round.roundDurationMs && round.finishedAt === round.endsAt;
  }
  return round.finishedAt >= round.startsAt && round.finishedAt < round.endsAt &&
    round.elapsedMs === Math.max(1, round.finishedAt - round.startsAt);
}

function validSavedState(state) {
  if (!hasExactKeys(state, ['players', 'rounds']) || !Array.isArray(state.players) || !Array.isArray(state.rounds)) return false;
  const playersById = new Map();
  const names = new Set();
  for (const player of state.players) {
    if (!hasExactKeys(player, ['id', 'name', 'roundsWon', 'roundsLost', 'bestTimesBySize']) ||
        !validId(player.id) || playersById.has(player.id) || typeof player.name !== 'string' ||
        !player.name || player.name.length > 24 || player.name !== player.name.trim() ||
        names.has(player.name.toLowerCase()) || !Number.isSafeInteger(player.roundsWon) || player.roundsWon < 0 ||
        !Number.isSafeInteger(player.roundsLost) || player.roundsLost < 0 ||
        !Number.isSafeInteger(player.roundsWon + player.roundsLost) ||
        !hasExactKeys(player.bestTimesBySize, ['8', '10', '14'])) return false;
    const bestTimes = Object.values(player.bestTimesBySize);
    if (!bestTimes.every((time) => time === null || (Number.isSafeInteger(time) && time >= 1)) ||
        bestTimes.filter((time) => time !== null).length > player.roundsWon) return false;
    playersById.set(player.id, player);
    names.add(player.name.toLowerCase());
  }

  const roundIds = new Set();
  const startIds = new Set();
  const cutIds = new Set();
  const activePlayers = new Set();
  const recordedCounts = new Map();
  for (const round of state.rounds) {
    if (!validSavedRound(round) || roundIds.has(round.id) || !playersById.has(round.playerId)) return false;
    roundIds.add(round.id);
    for (const id of round.startRequestIds) {
      if (startIds.has(id)) return false;
      startIds.add(id);
    }
    for (const id of round.cutRequestIds) {
      if (cutIds.has(id)) return false;
      cutIds.add(id);
    }
    if (!isRoundOver(round)) {
      if (activePlayers.has(round.playerId)) return false;
      activePlayers.add(round.playerId);
    } else if (round.recorded) {
      const player = playersById.get(round.playerId);
      const counts = recordedCounts.get(player.id) || { won: 0, lost: 0 };
      counts[round.status] += 1;
      recordedCounts.set(player.id, counts);
      if (counts.won > player.roundsWon || counts.lost > player.roundsLost) return false;
      if (round.status === 'won' && (player.bestTimesBySize[round.pizzaSize] === null ||
          player.bestTimesBySize[round.pizzaSize] > round.elapsedMs)) return false;
    }
  }
  return true;
}

export async function createAppServer({
  dataFile = join(projectDirectory, '.data', 'game.json'),
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
      if (error.code === 'ENOENT') return { players: [], rounds: [] };
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
      // Players and rounds replace the old file together, never half a result.
      await rename(temporaryFile, dataFile);
    } catch {
      await unlink(temporaryFile).catch(() => {});
      throw new RequestError(500, 'Your progress could not be saved. Please try again.');
    }
  }

  function recordResult(state, round) {
    if (!isRoundOver(round) || round.recorded) return false;
    const player = state.players.find((item) => item.id === round.playerId);
    if (!Number.isSafeInteger(player.roundsWon + player.roundsLost + 1)) {
      throw new RequestError(409, 'This player has reached the round limit.');
    }
    if (round.status === 'won') {
      player.roundsWon += 1;
      const best = player.bestTimesBySize[round.pizzaSize];
      if (best === null || round.elapsedMs < best) player.bestTimesBySize[round.pizzaSize] = round.elapsedMs;
    } else {
      player.roundsLost += 1;
    }
    round.recorded = true;
    return true;
  }

  function reconcileRounds(state, nowMs) {
    let changed = false;
    state.rounds = state.rounds.map((round) => {
      const updated = advanceRound(round, nowMs);
      if (updated !== round) changed = true;
      if (recordResult(state, updated)) changed = true;
      return updated;
    });
    return changed;
  }

  function trimHistory(state) {
    const finished = state.rounds.filter(isRoundOver)
      .sort((first, second) => second.finishedAt - first.finishedAt);
    if (finished.length <= terminalHistoryLimit) return false;
    const keep = new Set(finished.slice(0, terminalHistoryLimit).map((round) => round.id));
    state.rounds = state.rounds.filter((round) => !isRoundOver(round) || keep.has(round.id));
    return true;
  }

  function transact(operation) {
    const result = operationQueue.then(async () => {
      const saved = await loadState();
      const nowMs = clock();
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RequestError(500, 'The server clock is unavailable.');
      let reconciled = reconcileRounds(saved, nowMs);
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
      if (reconcileRounds(working, nowMs)) changed = true;
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

  function findRound(state, id) {
    const round = state.rounds.find((item) => item.id === id);
    if (!round) throw new RequestError(404, 'That round could not be found. Reload players to continue.');
    return round;
  }

  function checkRequestCapacity(round) {
    if (round.startRequestIds.length + round.cutRequestIds.length >= requestHistoryLimit) {
      throw new RequestError(429, 'This round has received too many requests. Reload its current result.');
    }
  }

  function roundFeedback(round) {
    if (round.status === 'won') return `Perfect portions! Your pizza has ${round.requiredSlices} slices.`;
    if (round.reason === 'wrong_cut') return 'Uneven slices! This round is lost.';
    if (round.reason === 'timeout') return "Time's up! This round is lost.";
    if (round.status === 'countdown') return 'Get ready. Wait for Go before cutting.';
    return 'Follow a dashed guide across the centre of the pizza.';
  }

  function envelope(state, round, nowMs, feedback = roundFeedback(round)) {
    return { round: toPublicRound(round, nowMs), player: publicPlayer(findPlayer(state, round.playerId)), feedback };
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
            const player = { id: randomUUID(), name, roundsWon: 0, roundsLost: 0, bestTimesBySize: { '8': null, '10': null, '14': null } };
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
            state.rounds = state.rounds.filter((round) => round.playerId !== id);
            return { status: 204, changed: true, body: () => null };
          });
        } else methodNotAllowed(response, ['PATCH', 'DELETE']);
      } else if (pathname === '/api/rounds') {
        if (request.method !== 'POST') methodNotAllowed(response, ['POST']);
        const body = await readJson(request);
        requireKeys(body, ['playerId', 'requestId'], 'A new round needs only playerId and requestId.');
        const playerId = cleanId(body.playerId);
        const requestId = cleanId(body.requestId);
        answer = await transact((state, nowMs) => {
          const previous = state.rounds.find((round) => round.startRequestIds.includes(requestId));
          if (previous) {
            if (previous.playerId !== playerId) throw new RequestError(409, 'That start request ID belongs to another player.');
            return { status: 200, changed: false, body: () => envelope(state, previous, nowMs) };
          }
          const player = findPlayer(state, playerId);
          const active = state.rounds.find((round) => round.playerId === playerId && !isRoundOver(round));
          if (active) {
            checkRequestCapacity(active);
            active.startRequestIds.push(requestId);
            return { status: 200, changed: true, body: () => envelope(state, active, nowMs, 'Your current round has been resumed.') };
          }
          if (player.roundsWon + player.roundsLost >= Number.MAX_SAFE_INTEGER) {
            throw new RequestError(409, 'This player has reached the round limit.');
          }
          const round = createRound({ id: randomUUID(), playerId, requestId }, rules, nowMs, random);
          round.startRequestIds = [requestId];
          state.rounds.push(round);
          return { status: 201, changed: true, body: () => envelope(state, round, nowMs) };
        });
      } else if (/^\/api\/rounds\/[^/]+\/cuts$/.test(pathname)) {
        if (request.method !== 'POST') methodNotAllowed(response, ['POST']);
        const id = decodeId(pathname.split('/')[3]);
        const body = await readJson(request);
        requireKeys(body, ['requestId', 'start', 'end'], 'A cut needs only requestId, start and end.');
        const requestId = cleanId(body.requestId);
        const stroke = { start: cleanPoint(body.start), end: cleanPoint(body.end) };
        answer = await transact((state, nowMs) => {
          const round = findRound(state, id);
          const previous = state.rounds.find((item) => item.cutRequestIds.includes(requestId));
          if (previous && previous.id !== id) throw new RequestError(409, 'That cut request ID belongs to another round.');
          if (isRoundOver(round)) {
            return { status: 200, changed: false, body: () => envelope(state, round, nowMs) };
          }
          if (previous) {
            return { status: 200, changed: false, body: () => envelope(state, round, nowMs, 'That cut request was already received.') };
          }
          checkRequestCapacity(round);
          const result = applyCut(round, stroke, nowMs);
          result.round.cutRequestIds.push(requestId);
          state.rounds[state.rounds.findIndex((item) => item.id === id)] = result.round;
          return { status: 200, changed: true, body: () => envelope(state, result.round, nowMs, result.feedback) };
        });
      } else if (/^\/api\/rounds\/[^/]+$/.test(pathname)) {
        if (request.method !== 'GET') methodNotAllowed(response, ['GET']);
        const id = decodeId(pathname.split('/')[3]);
        answer = await transact((state, nowMs) => {
          const round = findRound(state, id);
          return { status: 200, changed: false, body: () => envelope(state, round, nowMs) };
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
      console.log(`Pizza Slice Challenge is running at http://${host}:${server.address().port}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
