// Shared pure rules. Pizza centre = (0, 0); pizza radius = 1.
// Only the REST server creates runs, judges gestures, and awards points.
export const PIZZA_SLICES = Object.freeze({ 8: 4, 10: 6, 14: 8 });
export const ANGLE_TOLERANCE_DEG = 10;
export const CENTRE_TOLERANCE = 0.12;
export const SCORE_RULES = Object.freeze({ completedPizza: 10, wrongCut: 5, grenade: 10 });
export const DIFFICULTY_LEVELS = Object.freeze([
  Object.freeze({
    level: 1, startsAfterMs: 0, angleToleranceDeg: 10,
    grenadeChance: 0.15, grenadeDurationMs: 1600,
    pizzaWeights: Object.freeze({ 14: 1 / 3, 10: 1 / 3, 8: 1 / 3 })
  }),
  Object.freeze({
    level: 2, startsAfterMs: 20000, angleToleranceDeg: 8,
    grenadeChance: 0.30, grenadeDurationMs: 1900,
    pizzaWeights: Object.freeze({ 14: 0.50, 10: 0.30, 8: 0.20 })
  }),
  Object.freeze({
    level: 3, startsAfterMs: 40000, angleToleranceDeg: 6,
    grenadeChance: 0.50, grenadeDurationMs: 2200,
    pizzaWeights: Object.freeze({ 14: 0.65, 10: 0.25, 8: 0.10 })
  })
]);

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
      value.runDurationMs !== 60000 ||
      !Number.isSafeInteger(value.preparationMs) ||
      value.preparationMs < 0 || value.preparationMs > 10000 ||
      !Array.isArray(value.pizzas) || value.pizzas.length !== 3) {
    throw new Error('Version 3 needs a 60-second run, a valid preparation time, and three pizza sizes.');
  }
  const sizes = new Set();
  const pizzas = value.pizzas.map((pizza) => {
    if (!pizza || typeof pizza !== 'object' || Array.isArray(pizza) ||
        !Number.isInteger(pizza.sizeInches) || !Object.hasOwn(PIZZA_SLICES, pizza.sizeInches) ||
        PIZZA_SLICES[pizza.sizeInches] !== pizza.slices || sizes.has(pizza.sizeInches)) {
      throw new Error('Pizza sizes must be 14 inches / 8 slices, 10 inches / 6 slices, and 8 inches / 4 slices.');
    }
    sizes.add(pizza.sizeInches);
    return { sizeInches: pizza.sizeInches, slices: pizza.slices };
  });
  return { runDurationMs: 60000, preparationMs: value.preparationMs, pizzas };
}

function randomValue(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Random values must be between zero (inclusive) and one (exclusive).');
  }
  return value;
}

export function normaliseAngle(angle) {
  if (!Number.isFinite(angle)) throw new Error('An angle must be a finite number.');
  return ((angle % 180) + 180) % 180;
}

function difficultyAt(elapsedMs) {
  return DIFFICULTY_LEVELS.findLast((level) => elapsedMs >= level.startsAfterMs) || DIFFICULTY_LEVELS[0];
}

function defaultPizzaId() {
  return globalThis.crypto.randomUUID();
}

function createPizza(rules, spawnAt, difficulty, random, makePizzaId) {
  const selection = randomValue(random);
  let cumulative = 0;
  const chosen = rules.pizzas.find((pizza) => {
    cumulative += difficulty.pizzaWeights[pizza.sizeInches];
    return selection < cumulative;
  }) || rules.pizzas.at(-1);
  const rotation = Math.floor(randomValue(random) * 12) * 15;
  const requiredCuts = chosen.slices / 2;
  const guideAngles = Array.from({ length: requiredCuts }, (_, index) =>
    normaliseAngle(rotation + index * (180 / requiredCuts)));
  let grenade = null;
  if (randomValue(random) >= 1 - difficulty.grenadeChance) {
    const blockedGuide = guideAngles[Math.floor(randomValue(random) * guideAngles.length)];
    const side = randomValue(random) < 0.5 ? 1 : -1;
    const angle = blockedGuide * Math.PI / 180;
    grenade = {
      x: Math.cos(angle) * 0.70 * side, y: Math.sin(angle) * 0.70 * side,
      radius: 0.19, appearsAt: spawnAt, disappearsAt: spawnAt + difficulty.grenadeDurationMs
    };
  }
  const id = makePizzaId();
  if (!validId(id)) throw new Error('Each pizza needs a valid unique ID.');
  return {
    id, pizzaSize: chosen.sizeInches, requiredSlices: chosen.slices, requiredCuts,
    guideAngles, completedCuts: [], difficultyLevel: difficulty.level,
    angleToleranceDeg: difficulty.angleToleranceDeg, grenade
  };
}

export function createRun(identity, rawRules, nowMs, random = Math.random, makePizzaId = defaultPizzaId) {
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
    score: 0, pizzasCompleted: 0, pizzasSpoiled: 0, grenadesHit: 0,
    pizzaCountsBySize: { 8: 0, 10: 0, 14: 0 },
    currentPizza: createPizza(rules, startsAt, DIFFICULTY_LEVELS[0], random, makePizzaId),
    lastPizza: null
  };
}

export function isRunOver(run) {
  return Boolean(run && (run.status === 'won' || run.status === 'lost'));
}

// Timestamp comparisons keep the full minute accurate after refresh or a delayed request.
export function advanceRun(run, nowMs) {
  validClock(nowMs);
  if (!run || isRunOver(run)) return run;
  if (nowMs >= run.endsAt) {
    const won = run.score > run.bestBefore;
    return {
      ...run, status: won ? 'won' : 'lost', reason: won ? 'personal_best' : 'time_up',
      finishedAt: run.endsAt, elapsedMs: run.runDurationMs
    };
  }
  if (run.status === 'countdown' && nowMs >= run.startsAt) return { ...run, status: 'playing' };
  return run;
}

function validatePoint(point) {
  return point && typeof point === 'object' && !Array.isArray(point) &&
    Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 3 && Math.abs(point.y) <= 3;
}

export function strokeForAngle(angle, radius = 1.05) {
  if (!Number.isFinite(angle) || !Number.isFinite(radius) || radius < 0.8 || radius > 1.8) {
    throw new Error('A cutting angle and an edge-to-edge radius are required.');
  }
  const radians = normaliseAngle(angle) * Math.PI / 180;
  const x = Math.cos(radians) * radius;
  const y = Math.sin(radians) * radius;
  return { start: { x: -x, y: -y }, end: { x, y } };
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
  if (lengthSquared < 0.15 * 0.15) return false;
  const fraction = Math.max(0, Math.min(1,
    ((grenade.x - start.x) * dx + (grenade.y - start.y) * dy) / lengthSquared));
  return Math.hypot(start.x + fraction * dx - grenade.x,
    start.y + fraction * dy - grenade.y) <= grenade.radius + 1e-9;
}

function replacePizza(run, finishedPizza, outcome, nowMs, random, makePizzaId) {
  const currentPizza = createPizza(run.rulesSnapshot, nowMs,
    difficultyAt(nowMs - run.startsAt), random, makePizzaId);
  if (currentPizza.id === finishedPizza.id) throw new Error('A replacement pizza must have a new ID.');
  return {
    ...run, currentPizza,
    lastPizza: {
      ...finishedPizza, guideAngles: [...finishedPizza.guideAngles],
      completedCuts: [...finishedPizza.completedCuts],
      grenade: finishedPizza.grenade ? { ...finishedPizza.grenade } : null, outcome
    }
  };
}

export function applyRunCut(originalRun, stroke, nowMs, random = Math.random, makePizzaId = defaultPizzaId) {
  validClock(nowMs);
  if (!stroke || !validId(stroke.pizzaId) || !validatePoint(stroke.start) || !validatePoint(stroke.end)) {
    throw new Error('A cut needs a pizza ID and finite coordinates between -3 and 3.');
  }
  let run = advanceRun(originalRun, nowMs);
  if (!run) throw new Error('Start a run before cutting.');
  if (isRunOver(run)) return { run, feedback: "Time’s up! Your final score is " + run.score + '.', cutAccepted: false };
  if (run.status === 'countdown') return { run, feedback: 'Wait for Go before making a cut.', cutAccepted: false };
  if (stroke.pizzaId !== run.currentPizza.id) {
    return { run, feedback: 'A new pizza is ready. That earlier swipe was ignored.', cutAccepted: false };
  }
  const pizza = run.currentPizza;
  const { start, end } = stroke;
  if (hitsGrenade(start, end, pizza.grenade, nowMs)) {
    run = replacePizza({ ...run, score: Math.max(0, run.score - SCORE_RULES.grenade),
      grenadesHit: run.grenadesHit + 1 }, pizza, 'grenade', nowMs, random, makePizzaId);
    return { run, feedback: 'Boom! −10 points. Avoid the grenade and keep slicing.', cutAccepted: false };
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const startRadius = Math.hypot(start.x, start.y);
  const endRadius = Math.hypot(end.x, end.y);
  if (length < 1.3 || startRadius < 0.8 || endRadius < 0.8 || startRadius > 1.8 || endRadius > 1.8) {
    return { run, feedback: 'Swipe from one crust edge through the centre to the opposite edge.', cutAccepted: false };
  }
  const closestFraction = -(start.x * dx + start.y * dy) / (length * length);
  const distanceFromCentre = Math.abs(start.x * end.y - start.y * end.x) / length;
  if (closestFraction <= 0 || closestFraction >= 1 || distanceFromCentre >= 1) {
    return { run, feedback: 'That swipe missed. Follow a dashed guide across the pizza.', cutAccepted: false };
  }
  const angle = normaliseAngle(Math.atan2(dy, dx) * 180 / Math.PI);
  let guideIndex = 0;
  let nearestDistance = Infinity;
  pizza.guideAngles.forEach((guideAngle, index) => {
    const distance = angleDistance(angle, guideAngle);
    if (distance < nearestDistance) { nearestDistance = distance; guideIndex = index; }
  });
  if (distanceFromCentre > CENTRE_TOLERANCE + 1e-9 || nearestDistance > pizza.angleToleranceDeg + 1e-9) {
    run = replacePizza({ ...run, score: Math.max(0, run.score - SCORE_RULES.wrongCut),
      pizzasSpoiled: run.pizzasSpoiled + 1 }, pizza, 'spoiled', nowMs, random, makePizzaId);
    return { run, feedback: 'Uneven slices! −5 points. Try the next pizza.', cutAccepted: false };
  }
  if (pizza.completedCuts.includes(guideIndex)) {
    return { run, feedback: 'That cut is already made. Choose another dashed guide.', cutAccepted: false };
  }
  const cutPizza = { ...pizza, completedCuts: [...pizza.completedCuts, guideIndex] };
  if (cutPizza.completedCuts.length === cutPizza.requiredCuts) {
    run = replacePizza({
      ...run, score: run.score + SCORE_RULES.completedPizza, pizzasCompleted: run.pizzasCompleted + 1,
      pizzaCountsBySize: { ...run.pizzaCountsBySize,
        [pizza.pizzaSize]: run.pizzaCountsBySize[pizza.pizzaSize] + 1 }
    }, cutPizza, 'completed', nowMs, random, makePizzaId);
    return { run, feedback: 'Perfect portions! +10 points. Next pizza!', cutAccepted: true };
  }
  run = { ...run, currentPizza: cutPizza };
  const left = cutPizza.requiredCuts - cutPizza.completedCuts.length;
  return { run, feedback: 'Good cut! ' + left + (left === 1 ? ' cut left.' : ' cuts left.'), cutAccepted: true };
}

function publicPizza(pizza) {
  if (!pizza) return null;
  const result = {
    id: pizza.id, pizzaSize: pizza.pizzaSize, requiredSlices: pizza.requiredSlices,
    requiredCuts: pizza.requiredCuts, guideAngles: [...pizza.guideAngles],
    completedCuts: [...pizza.completedCuts],
    currentSlices: pizza.completedCuts.length === 0 ? 1 : pizza.completedCuts.length * 2,
    difficultyLevel: pizza.difficultyLevel, angleToleranceDeg: pizza.angleToleranceDeg,
    grenade: pizza.grenade ? { ...pizza.grenade } : null
  };
  if (pizza.outcome) result.outcome = pizza.outcome;
  return result;
}

// The server reconciles the run and records its result before presenting this view.
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
    grenadesHit: run.grenadesHit, pizzaCountsBySize: { ...run.pizzaCountsBySize },
    currentPizza: publicPizza(run.currentPizza), lastPizza: publicPizza(run.lastPizza)
  };
}
