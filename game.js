// Shared, pure rules. Pizza centre = (0, 0); pizza radius = 1.
export const PIZZA_SLICES = Object.freeze({ 8: 4, 10: 6, 14: 8 });
export const ANGLE_TOLERANCE_DEG = 10;
export const CENTRE_TOLERANCE = 0.12;

function validClock(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('The round clock must be finite and non-negative.');
  return value;
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
}

export function validateRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isSafeInteger(value.roundDurationMs) ||
      value.roundDurationMs < 1000 || value.roundDurationMs > 120000 ||
      !Number.isSafeInteger(value.preparationMs) ||
      value.preparationMs < 0 || value.preparationMs > 10000 ||
      !Array.isArray(value.pizzas) || value.pizzas.length !== 3) {
    throw new Error('Game settings need a valid round time, preparation time, and three pizza sizes.');
  }
  const sizes = new Set();
  const pizzas = value.pizzas.map((pizza) => {
    if (!pizza || typeof pizza !== 'object' || !Number.isInteger(pizza.sizeInches) ||
        !Object.hasOwn(PIZZA_SLICES, pizza.sizeInches) ||
        PIZZA_SLICES[pizza.sizeInches] !== pizza.slices || sizes.has(pizza.sizeInches)) {
      throw new Error('Pizza sizes must be 14 inches / 8 slices, 10 inches / 6 slices, and 8 inches / 4 slices.');
    }
    sizes.add(pizza.sizeInches);
    return { sizeInches: pizza.sizeInches, slices: pizza.slices };
  });
  return { roundDurationMs: value.roundDurationMs, preparationMs: value.preparationMs, pizzas };
}

function randomValue(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Random values must be between zero (inclusive) and one (exclusive).');
  return value;
}

export function normaliseAngle(angle) {
  return ((angle % 180) + 180) % 180;
}

export function createRound(identity, rawRules, nowMs, random = Math.random) {
  validClock(nowMs);
  if (!identity || !validId(identity.id) || !validId(identity.playerId) || !validId(identity.requestId)) {
    throw new Error('A round needs valid round, player, and request IDs.');
  }
  const rules = validateRules(rawRules);
  const pizza = rules.pizzas[Math.floor(randomValue(random) * rules.pizzas.length)];
  // Fifteen-degree rotations remain practical with a mouse, touch, or keyboard.
  const rotation = Math.floor(randomValue(random) * 12) * 15;
  const requiredCuts = pizza.slices / 2;
  const startsAt = nowMs + rules.preparationMs;
  return {
    id: identity.id, playerId: identity.playerId, requestId: identity.requestId,
    pizzaSize: pizza.sizeInches, requiredSlices: pizza.slices, requiredCuts,
    guideAngles: Array.from({ length: requiredCuts }, (_, index) =>
      normaliseAngle(rotation + index * (180 / requiredCuts))),
    completedCuts: [], status: rules.preparationMs > 0 ? 'countdown' : 'playing',
    reason: null, elapsedMs: null, createdAt: nowMs, startsAt,
    endsAt: startsAt + rules.roundDurationMs, finishedAt: null,
    roundDurationMs: rules.roundDurationMs, cutRequestIds: [], recorded: false
  };
}

export function isRoundOver(round) {
  return Boolean(round && (round.status === 'won' || round.status === 'lost'));
}

function finishRound(round, status, reason, nowMs) {
  return {
    ...round, status, reason,
    elapsedMs: reason === 'timeout' ? round.roundDurationMs : Math.max(1, Math.floor(nowMs - round.startsAt)),
    finishedAt: reason === 'timeout' ? round.endsAt : nowMs
  };
}

// Compare timestamps, rather than subtracting one second per callback.
export function advanceRound(round, nowMs) {
  validClock(nowMs);
  if (!round || isRoundOver(round)) return round;
  if (nowMs >= round.endsAt) return finishRound(round, 'lost', 'timeout', nowMs);
  if (round.status === 'countdown' && nowMs >= round.startsAt) return { ...round, status: 'playing' };
  return round;
}

function validatePoint(point) {
  return point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Math.abs(point.x) <= 3 && Math.abs(point.y) <= 3;
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

export function applyCut(originalRound, stroke, nowMs) {
  validClock(nowMs);
  if (!stroke || !validatePoint(stroke.start) || !validatePoint(stroke.end)) {
    throw new Error('Cut coordinates must be finite numbers between -3 and 3.');
  }
  let round = advanceRound(originalRound, nowMs);
  if (!round) throw new Error('Start a round before cutting.');
  if (isRoundOver(round)) {
    return { round, feedback: round.reason === 'timeout' ? "Time's up!" : 'This round has finished.', cutAccepted: false };
  }
  if (round.status === 'countdown') {
    return { round, feedback: 'Wait for Go before making a cut.', cutAccepted: false };
  }
  const { start, end } = stroke;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const startRadius = Math.hypot(start.x, start.y);
  const endRadius = Math.hypot(end.x, end.y);
  if (length < 1.3 || startRadius < 0.8 || endRadius < 0.8 || startRadius > 1.8 || endRadius > 1.8) {
    return { round, feedback: 'Start near the crust and drag all the way to the opposite crust.', cutAccepted: false };
  }
  const closestFraction = -(start.x * dx + start.y * dy) / (length * length);
  const distanceFromCentre = Math.abs(start.x * end.y - start.y * end.x) / length;
  if (closestFraction <= 0 || closestFraction >= 1 || distanceFromCentre >= 1) {
    return { round, feedback: 'That swipe missed the pizza. Follow a dashed guide across its centre.', cutAccepted: false };
  }
  const angle = normaliseAngle(Math.atan2(dy, dx) * 180 / Math.PI);
  let guideIndex = 0;
  let nearestDistance = Infinity;
  round.guideAngles.forEach((guideAngle, index) => {
    const distance = angleDistance(angle, guideAngle);
    if (distance < nearestDistance) { nearestDistance = distance; guideIndex = index; }
  });
  if (distanceFromCentre > CENTRE_TOLERANCE + 1e-9 || nearestDistance > ANGLE_TOLERANCE_DEG + 1e-9) {
    round = finishRound(round, 'lost', 'wrong_cut', nowMs);
    return { round, feedback: 'Uneven slices! Cut through the centre along the dashed guides.', cutAccepted: false };
  }
  if (round.completedCuts.includes(guideIndex)) {
    return { round, feedback: 'That cut is already made. Choose another dashed guide.', cutAccepted: false };
  }
  round = { ...round, completedCuts: [...round.completedCuts, guideIndex] };
  if (round.completedCuts.length === round.requiredCuts) {
    round = finishRound(round, 'won', 'correct_slices', nowMs);
    return {
      round, feedback: 'Perfect portions! Your ' + round.pizzaSize + '-inch pizza has ' + round.requiredSlices + ' slices.',
      cutAccepted: true
    };
  }
  const left = round.requiredCuts - round.completedCuts.length;
  return { round, feedback: 'Good cut! ' + left + (left === 1 ? ' cut left.' : ' cuts left.'), cutAccepted: true };
}

// The server advances and records an outcome before presenting this view.
export function toPublicRound(round, nowMs) {
  validClock(nowMs);
  const remainingMs = isRoundOver(round)
    ? Math.max(0, round.roundDurationMs - round.elapsedMs)
    : round.status === 'countdown' ? round.roundDurationMs : Math.max(0, round.endsAt - nowMs);
  return {
    id: round.id, playerId: round.playerId, pizzaSize: round.pizzaSize,
    requiredSlices: round.requiredSlices, requiredCuts: round.requiredCuts,
    guideAngles: [...round.guideAngles], completedCuts: [...round.completedCuts],
    currentSlices: round.completedCuts.length === 0 ? 1 : round.completedCuts.length * 2,
    status: round.status, reason: round.reason, elapsedMs: round.elapsedMs,
    startsAt: round.startsAt, endsAt: round.endsAt, serverTime: nowMs, remainingMs,
    countdownMs: round.status === 'countdown' ? Math.max(0, round.startsAt - nowMs) : 0
  };
}

export function sortPlayersByBestTime(players, pizzaSize = 14) {
  if (!Array.isArray(players) || !Object.hasOwn(PIZZA_SLICES, pizzaSize)) throw new Error('Choose an 8-, 10-, or 14-inch leaderboard.');
  return [...players].sort((first, second) => {
    const firstTime = first.bestTimesBySize?.[pizzaSize] ?? Infinity;
    const secondTime = second.bestTimesBySize?.[pizzaSize] ?? Infinity;
    return (firstTime - secondTime) || (second.roundsWon - first.roundsWon) ||
      (first.roundsLost - second.roundsLost) || first.name.localeCompare(second.name);
  });
}
