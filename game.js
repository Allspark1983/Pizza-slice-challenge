// Shared scoring rules for Versions 3.1–3.3. Coordinates use the whole board.
// The REST server owns the clocks, random batches, accepted cuts, and score.
export const PIZZA_SLICES = Object.freeze({ 10: 4, 12: 6, 14: 8 });
export const ARENA = Object.freeze({ left: -150, right: 150, top: -140, bottom: 140 });
export const ANGLE_TOLERANCE_DEG = 10;
export const CENTRE_TOLERANCE = 0.18;
export const GRENADE_DURATION_MS = 1800;
export const SCORE_RULES = Object.freeze({ completedPizza: 10, wrongCut: 5, grenade: 10, missedPizza: 5 });
export const DIFFICULTY_LEVELS = Object.freeze([
  Object.freeze({ level: 1, startsAfterMs: 0, pizzasPerWave: 1 }),
  Object.freeze({ level: 2, startsAfterMs: 20000, pizzasPerWave: 2 }),
  Object.freeze({ level: 3, startsAfterMs: 40000, pizzasPerWave: 3 })
]);
const LAYOUTS = {
  1: [{ x: 0, y: 0 }],
  2: [{ x: -70, y: 0 }, { x: 70, y: 0 }],
  3: [{ x: -70, y: -50 }, { x: 70, y: -50 }, { x: 0, y: 65 }]
};
const EPSILON = 1e-9;

function validClock(value) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error('The run clock must be finite and non-negative.');
  }
  return value;
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
}

export function validateRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.mode !== 'arcade-3.1' || value.runDurationMs !== 60000 || value.waveDurationMs !== 5000 ||
      !Number.isSafeInteger(value.preparationMs) || value.preparationMs < 0 || value.preparationMs > 10000 ||
      !Array.isArray(value.pizzas) || value.pizzas.length !== 3) {
    throw new Error('Version 3.1 needs a 60-second run, five-second batches, and three pizza sizes.');
  }
  const sizes = new Set();
  for (const pizza of value.pizzas) {
    if (!pizza || typeof pizza !== 'object' || Array.isArray(pizza) ||
        !Number.isInteger(pizza.sizeInches) || !Object.hasOwn(PIZZA_SLICES, pizza.sizeInches) ||
        PIZZA_SLICES[pizza.sizeInches] !== pizza.slices || sizes.has(pizza.sizeInches)) {
      throw new Error('Use 10 inches / 4 slices, 12 inches / 6 slices, and 14 inches / 8 slices.');
    }
    sizes.add(pizza.sizeInches);
  }
  return {
    mode: 'arcade-3.1', runDurationMs: 60000, preparationMs: value.preparationMs, waveDurationMs: 5000,
    pizzas: Object.entries(PIZZA_SLICES).map(([size, slices]) => ({ sizeInches: Number(size), slices }))
  };
}

function randomValue(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Random values must be between zero (inclusive) and one (exclusive).');
  }
  return value;
}

function defaultId() { return globalThis.crypto.randomUUID(); }

function newId(makeId, usedIds) {
  const id = makeId();
  if (!validId(id) || usedIds.has(id)) throw new Error('Every batch and pizza needs a new valid ID.');
  usedIds.add(id);
  return id;
}

export function normaliseAngle(angle) {
  if (!Number.isFinite(angle)) throw new Error('An angle must be a finite number.');
  return ((angle % 180) + 180) % 180;
}

function createWave(rules, waveIndex, waveStartsAt, random, makeId, previousRun = null) {
  const elapsedMs = waveIndex * rules.waveDurationMs;
  const difficulty = DIFFICULTY_LEVELS.findLast((level) => elapsedMs >= level.startsAfterMs);
  const usedIds = new Set(previousRun ? [previousRun.waveId,
    ...previousRun.pizzas.map((pizza) => pizza.id), ...previousRun.lastEvents.map((event) => event.pizza.id)] : []);
  const waveId = newId(makeId, usedIds);
  const pizzas = LAYOUTS[difficulty.pizzasPerWave].map(({ x, y }) => {
    const chosen = rules.pizzas[Math.floor(randomValue(random) * rules.pizzas.length)];
    const radius = chosen.sizeInches * 3;
    let grenade = null;
    if (randomValue(random) >= 0.8) {
      const angle = Math.floor(randomValue(random) * 12) * Math.PI / 6;
      grenade = {
        x: x + Math.cos(angle) * radius * 0.65, y: y + Math.sin(angle) * radius * 0.65,
        radius: radius * 0.20, appearsAt: waveStartsAt, disappearsAt: waveStartsAt + GRENADE_DURATION_MS
      };
    }
    return {
      id: newId(makeId, usedIds), pizzaSize: chosen.sizeInches,
      requiredSlices: chosen.slices, requiredCuts: chosen.slices / 2, x, y, radius,
      anchorAngle: null, completedCuts: [], grenade
    };
  });
  return {
    waveIndex, waveId, waveStartsAt, waveEndsAt: waveStartsAt + rules.waveDurationMs,
    difficultyLevel: difficulty.level, pizzas
  };
}

export function createRun(identity, rawRules, nowMs, random = Math.random, makeId = defaultId) {
  validClock(nowMs);
  if (!identity || !validId(identity.id) || !validId(identity.playerId) || !validId(identity.requestId) ||
      !Number.isSafeInteger(identity.bestScore) || identity.bestScore < 0 ||
      identity.bestScore >= Number.MAX_SAFE_INTEGER) {
    throw new Error('A run needs valid run, player, and request IDs and a non-negative best score.');
  }
  const rules = validateRules(rawRules);
  const startsAt = nowMs + rules.preparationMs;
  const endsAt = startsAt + rules.runDurationMs;
  validClock(endsAt);
  return {
    id: identity.id, playerId: identity.playerId, requestId: identity.requestId,
    startRequestIds: [identity.requestId], cutRequestIds: [], recorded: false,
    status: rules.preparationMs > 0 ? 'countdown' : 'playing', reason: null,
    createdAt: nowMs, startsAt, endsAt, finishedAt: null, elapsedMs: null,
    runDurationMs: rules.runDurationMs, rulesSnapshot: rules,
    bestBefore: identity.bestScore, targetScore: identity.bestScore + 1,
    score: 0, pizzasCompleted: 0, pizzasSpoiled: 0, grenadesHit: 0, pizzasMissed: 0,
    pizzaCountsBySize: { 10: 0, 12: 0, 14: 0 }, lastEvents: [], eventSerial: 0,
    ...createWave(rules, 0, startsAt, random, makeId)
  };
}

export function isRunOver(run) {
  return Boolean(run && (run.status === 'won' || run.status === 'lost'));
}

function clonePizza(pizza) {
  return { ...pizza, completedCuts: [...pizza.completedCuts], grenade: pizza.grenade ? { ...pizza.grenade } : null };
}

function recordOutcome(run, pizza, outcome, events) {
  const next = { ...run, eventSerial: run.eventSerial + 1 };
  if (outcome === 'completed') {
    next.score += SCORE_RULES.completedPizza;
    next.pizzasCompleted += 1;
    next.pizzaCountsBySize = { ...run.pizzaCountsBySize,
      [pizza.pizzaSize]: run.pizzaCountsBySize[pizza.pizzaSize] + 1 };
  } else {
    const [counter, penalty] = {
      spoiled: ['pizzasSpoiled', SCORE_RULES.wrongCut],
      grenade: ['grenadesHit', SCORE_RULES.grenade],
      missed: ['pizzasMissed', SCORE_RULES.missedPizza]
    }[outcome];
    next[counter] += 1;
    next.score = Math.max(0, next.score - penalty);
  }
  events.push({ id: run.id + '-event-' + next.eventSerial, outcome, pizza: clonePizza(pizza) });
  return next;
}

// Every expired batch is reconciled at its scheduled deadline, including the last one.
// Catch-up therefore gives the same result as checking the server every five seconds.
export function advanceRun(originalRun, nowMs, random = Math.random, makeId = defaultId) {
  validClock(nowMs);
  if (!originalRun || isRunOver(originalRun)) return originalRun;
  let run = originalRun;
  if (run.status === 'countdown' && nowMs >= run.startsAt) run = { ...run, status: 'playing' };
  while (nowMs >= run.waveEndsAt) {
    const events = [];
    for (const pizza of run.pizzas) run = recordOutcome(run, pizza, 'missed', events);
    run = { ...run, pizzas: [], lastEvents: events.length ? events : run.lastEvents };
    if (run.waveEndsAt >= run.endsAt) {
      const won = run.score > run.bestBefore;
      return { ...run, status: won ? 'won' : 'lost', reason: won ? 'personal_best' : 'time_up',
        finishedAt: run.endsAt, elapsedMs: run.runDurationMs };
    }
    run = { ...run, ...createWave(run.rulesSnapshot, run.waveIndex + 1, run.waveEndsAt, random, makeId, run) };
  }
  return run;
}

function validatePoint(point) {
  return point && typeof point === 'object' && !Array.isArray(point) &&
    Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 200 && Math.abs(point.y) <= 200;
}

// Unit-space helper retained for calculations; gameplay uses strokeForPizza below.
export function strokeForAngle(angle, radius = 1.05) {
  if (!Number.isFinite(angle) || !Number.isFinite(radius) || radius < 0.8 || radius > 1.8) {
    throw new Error('A cutting angle and an edge-to-edge radius are required.');
  }
  const radians = normaliseAngle(angle) * Math.PI / 180;
  const x = Math.cos(radians) * radius;
  const y = Math.sin(radians) * radius;
  return { start: { x: -x, y: -y }, end: { x, y } };
}

export function strokeForPizza(pizza, angle) {
  if (!pizza || !Number.isFinite(pizza.x) || !Number.isFinite(pizza.y) ||
      !Number.isFinite(pizza.radius) || pizza.radius <= 0) throw new Error('Select a pizza before cutting.');
  const unit = strokeForAngle(angle);
  const stroke = {
    start: { x: pizza.x + unit.start.x * pizza.radius, y: pizza.y + unit.start.y * pizza.radius },
    end: { x: pizza.x + unit.end.x * pizza.radius, y: pizza.y + unit.end.y * pizza.radius }
  };
  if (!validatePoint(stroke.start) || !validatePoint(stroke.end)) throw new Error('The selected pizza is outside the board.');
  return stroke;
}

function angleDistance(first, second) {
  const distance = Math.abs(normaliseAngle(first) - normaliseAngle(second));
  return Math.min(distance, 180 - distance);
}

function hitsGrenade(start, end, grenade, nowMs) {
  if (!grenade || nowMs < grenade.appearsAt || nowMs >= grenade.disappearsAt) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 9) return false;
  const fraction = Math.max(0, Math.min(1,
    ((grenade.x - start.x) * dx + (grenade.y - start.y) * dy) / lengthSquared));
  return Math.hypot(start.x + fraction * dx - grenade.x,
    start.y + fraction * dy - grenade.y) <= grenade.radius + EPSILON;
}

function judgePizza(pizza, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { type: 'ignored' };
  const projection = ((pizza.x - start.x) * dx + (pizza.y - start.y) * dy) / length;
  const centreDistance = Math.abs((pizza.x - start.x) * dy - (pizza.y - start.y) * dx) / length;
  // No maximum endpoint distance: one long swipe can cross several whole pizzas.
  if (projection + EPSILON < 0.8 * pizza.radius || length - projection + EPSILON < 0.8 * pizza.radius ||
      centreDistance >= pizza.radius) return { type: 'ignored' };
  if (centreDistance > CENTRE_TOLERANCE * pizza.radius + EPSILON) return { type: 'spoiled' };
  const angle = normaliseAngle(Math.atan2(dy, dx) * 180 / Math.PI);
  if (pizza.anchorAngle === null) {
    return { type: 'accepted', pizza: { ...pizza, anchorAngle: angle, completedCuts: [0] } };
  }
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < pizza.requiredCuts; index += 1) {
    const distance = angleDistance(angle, pizza.anchorAngle + index * (180 / pizza.requiredCuts));
    if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
  }
  if (nearestDistance > ANGLE_TOLERANCE_DEG + EPSILON) return { type: 'spoiled' };
  if (pizza.completedCuts.includes(nearestIndex)) return { type: 'duplicate' };
  return { type: 'accepted', pizza: { ...pizza, completedCuts: [...pizza.completedCuts, nearestIndex] } };
}

export function applyRunCut(originalRun, stroke, nowMs, random = Math.random, makeId = defaultId) {
  validClock(nowMs);
  if (!stroke || !validId(stroke.waveId) || !validatePoint(stroke.start) || !validatePoint(stroke.end)) {
    throw new Error('A cut needs a batch ID and finite board coordinates between -200 and 200.');
  }
  let run = advanceRun(originalRun, nowMs, random, makeId);
  if (!run) throw new Error('Start a run before cutting.');
  if (isRunOver(run)) return { run, feedback: 'Time’s up! Your final score is ' + run.score + '.', cutAccepted: false };
  if (run.status === 'countdown') return { run, feedback: 'Wait for Go before making a cut.', cutAccepted: false };
  if (stroke.waveId !== run.waveId) {
    return { run, feedback: 'A new batch has arrived. That earlier swipe was ignored.', cutAccepted: false };
  }
  const pizzas = [];
  const events = [];
  let accepted = 0;
  let duplicates = 0;
  for (const pizza of run.pizzas) {
    if (hitsGrenade(stroke.start, stroke.end, pizza.grenade, nowMs)) {
      run = recordOutcome(run, pizza, 'grenade', events);
      continue;
    }
    const judged = judgePizza(pizza, stroke.start, stroke.end);
    if (judged.type === 'spoiled') run = recordOutcome(run, pizza, 'spoiled', events);
    else if (judged.type === 'accepted') {
      accepted += 1;
      if (judged.pizza.completedCuts.length === pizza.requiredCuts) run = recordOutcome(run, judged.pizza, 'completed', events);
      else pizzas.push(judged.pizza);
    } else {
      if (judged.type === 'duplicate') duplicates += 1;
      pizzas.push(pizza);
    }
  }
  if (accepted || events.length) run = { ...run, pizzas, lastEvents: events.length ? events : run.lastEvents };
  let feedback;
  if (events.length) {
    const labels = { completed: 'Perfect portions! +10 points.', spoiled: 'Uneven slices! −5 points.',
      grenade: 'Boom! −10 points.', missed: 'Missed pizza! −5 points.' };
    feedback = events.map((event) => labels[event.outcome]).join(' ');
    if (run.pizzas.length === 0) feedback += ' Board clear—next batch arrives on the timer.';
  } else if (accepted) feedback = 'Good cut' + (accepted > 1 ? ' across ' + accepted + ' pizzas' : '') + '! Keep the slices equal.';
  else if (duplicates) feedback = 'That cut is already made. Cut a different diameter to form equal slices.';
  else if (run.pizzas.length === 0) feedback = 'Board clear. Get ready for the next batch.';
  else feedback = 'Swipe across the whole pizza through its centre. Your first cut sets the direction.';
  return { run, feedback, cutAccepted: accepted > 0 };
}

function publicPizza(pizza) {
  return {
    id: pizza.id, pizzaSize: pizza.pizzaSize, requiredSlices: pizza.requiredSlices,
    requiredCuts: pizza.requiredCuts, x: pizza.x, y: pizza.y, radius: pizza.radius,
    cutAngles: pizza.completedCuts.map((index) => normaliseAngle(pizza.anchorAngle + index * (180 / pizza.requiredCuts))),
    currentSlices: pizza.completedCuts.length === 0 ? 1 : pizza.completedCuts.length * 2,
    grenade: pizza.grenade ? { ...pizza.grenade } : null
  };
}

// The server reconciles all deadlines and records results before presenting this view.
export function toPublicRun(run, nowMs) {
  validClock(nowMs);
  return {
    id: run.id, playerId: run.playerId, status: run.status, reason: run.reason,
    startsAt: run.startsAt, endsAt: run.endsAt, serverTime: nowMs,
    remainingMs: isRunOver(run) ? 0 : run.status === 'countdown' ? run.runDurationMs :
      Math.max(0, Math.min(run.runDurationMs, run.endsAt - nowMs)),
    countdownMs: run.status === 'countdown' ? Math.max(0, run.startsAt - nowMs) : 0,
    elapsedMs: run.elapsedMs, bestBefore: run.bestBefore, targetScore: run.targetScore,
    score: run.score, pizzasCompleted: run.pizzasCompleted, pizzasSpoiled: run.pizzasSpoiled,
    grenadesHit: run.grenadesHit, pizzasMissed: run.pizzasMissed,
    pizzaCountsBySize: { ...run.pizzaCountsBySize },
    waveIndex: run.waveIndex, waveId: run.waveId, waveStartsAt: run.waveStartsAt, waveEndsAt: run.waveEndsAt,
    difficultyLevel: run.difficultyLevel, pizzas: run.pizzas.map(publicPizza),
    lastEvents: run.lastEvents.map((event) => ({ id: event.id, outcome: event.outcome, pizza: publicPizza(event.pizza) }))
  };
}
