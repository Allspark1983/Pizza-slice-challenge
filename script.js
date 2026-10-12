import { validateRules, strokeForAngle, strokeForPizza, SCORE_RULES, DIFFICULTY_LEVELS } from './game.js';
import { BATCH_ENTRY_MS, BATCH_ENTRY_DISTANCE, entranceOffset, clipStrokeToBounds } from './motion.js';

// 1. SELECT: find page elements once. Timer ticks never replace the SVG or form.
const elements = {
  connectionStatus: document.querySelector('#connection-status'),
  gamePanel: document.querySelector('.game-panel'),
  playerSelect: document.querySelector('#player-select'),
  editProfile: document.querySelector('#edit-profile'),
  deleteProfile: document.querySelector('#delete-profile'),
  profileEditor: document.querySelector('#profile-editor'),
  profileEditorTitle: document.querySelector('#profile-editor-title'),
  playerForm: document.querySelector('#player-form'),
  playerFormTitle: document.querySelector('#player-form-title'),
  playerName: document.querySelector('#player-name'),
  playerSubmit: document.querySelector('#player-submit'),
  cancelEdit: document.querySelector('#cancel-edit'),
  playerMessage: document.querySelector('#player-message'),
  profileBestScore: document.querySelector('#profile-best-score'),
  profileBestPizzas: document.querySelector('#profile-best-pizzas'),
  profileRunsPlayed: document.querySelector('#profile-runs-played'),
  profileTotalPizzas: document.querySelector('#profile-total-pizzas'),
  profileRunsWon: document.querySelector('#profile-runs-won'),
  profileRunsLost: document.querySelector('#profile-runs-lost'),
  previousBestRecord: document.querySelector('#previous-best-record'),
  previousBestScore: document.querySelector('#previous-best-score'),
  activePlayerName: document.querySelector('#active-player-name'),
  scoreDisplay: document.querySelector('#score-display'),
  bestToBeat: document.querySelector('#best-to-beat'),
  pizzasCompleted: document.querySelector('#pizzas-completed'),
  pizzasSpoiled: document.querySelector('#pizzas-spoiled'),
  grenadesHit: document.querySelector('#grenades-hit'),
  pizzasMissed: document.querySelector('#pizzas-missed'),
  runStatus: document.querySelector('#run-status'),
  runTimer: document.querySelector('#run-timer'),
  timerLabel: document.querySelector('#timer-label'),
  timerDisplay: document.querySelector('#timer-display'),
  timerProgress: document.querySelector('#timer-progress'),
  countdownAnnouncement: document.querySelector('#countdown-announcement'),
  hazardAnnouncement: document.querySelector('#hazard-announcement'),
  batchTitle: document.querySelector('#batch-title'),
  batchLabel: document.querySelector('#batch-label'),
  batchTimer: document.querySelector('#batch-timer'),
  batchProgress: document.querySelector('#batch-progress'),
  difficultyDisplay: document.querySelector('#difficulty-display'),
  hazardStatus: document.querySelector('#hazard-status'),
  pizzaBoard: document.querySelector('#pizza-board'),
  pizzaSVG: document.querySelector('#pizza-svg'),
  batchMotion: document.querySelector('#batch-motion'),
  wholePizzaArt: document.querySelector('#whole-pizza-art'),
  pizzasLayer: document.querySelector('#pizzas-layer'),
  grenadeArtTemplate: document.querySelector('#grenade-art-template'),
  grenadesLayer: document.querySelector('#grenades-layer'),
  bladeLayer: document.querySelector('#blade-layer'),
  bladeShadow: document.querySelector('#blade-shadow'),
  bladeLine: document.querySelector('#blade-line'),
  pizzaFeedbackLayer: document.querySelector('#pizza-feedback-layer'),
  scoreFeedback: document.querySelector('#score-feedback'),
  boardOverlay: document.querySelector('#board-overlay'),
  boardOverlayText: document.querySelector('#board-overlay-text'),
  boardSummary: document.querySelector('#board-summary'),
  keyboardControls: document.querySelector('#keyboard-controls'),
  targetPizza: document.querySelector('#target-pizza'),
  bladeAngle: document.querySelector('#blade-angle'),
  bladeAngleValue: document.querySelector('#blade-angle-value'),
  cutAngle: document.querySelector('#cut-angle'),
  resultBanner: document.querySelector('#result-banner'),
  resultTitle: document.querySelector('#result-title'),
  resultDetail: document.querySelector('#result-detail'),
  startRun: document.querySelector('#start-run'),
  createProfileShortcut: document.querySelector('#create-profile-shortcut'),
  retryAction: document.querySelector('#retry-action'),
  checkRun: document.querySelector('#check-run'),
  reloadPlayers: document.querySelector('#reload-players'),
  gameMessage: document.querySelector('#game-message'),
  completePoints: document.querySelector('#complete-points'),
  wrongPenalty: document.querySelector('#wrong-penalty'),
  grenadePenalty: document.querySelector('#grenade-penalty'),
  missedPenalty: document.querySelector('#missed-penalty'),
  timingSummary: document.querySelector('#timing-summary'),
  sizeRules: document.querySelector('#size-rules'),
  deleteDialog: document.querySelector('#delete-dialog'),
  deletePlayerName: document.querySelector('#delete-player-name'),
  confirmDelete: document.querySelector('#confirm-delete'),
  cancelDelete: document.querySelector('#cancel-delete')
};

// 2. DATA: score, pizzas, difficulty, time, and verdicts come from the server.
const recoveryKey = 'four-pizza-slice-rush.v3.1';
const svgNamespace = 'http://www.w3.org/2000/svg';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let rules = {
  mode: 'arcade-3.1', runDurationMs: 60000, preparationMs: 3000, waveDurationMs: 5000,
  pizzas: [{ sizeInches: 10, slices: 4 }, { sizeInches: 12, slices: 6 }, { sizeInches: 14, slices: 8 }]
};
let players = [];
let activePlayerId = null;
let editingPlayerId = null;
let deletingPlayerId = null;
let run = null;
let knownRunId = null;
let pendingAction = null;
let loaded = false;
let busy = false;
let requestFailure = '';
let clockAnchor = null;
let clockInterval = null;
let announcedCountdown = null;
let announcedHazards = '';
let checkedBoundaries = new Set();
let pointerStroke = null;
let renderedPizzas = [];
let renderedPizzaKey = null;
let selectedPizzaId = null;
let renderedTargetKey = '';
let grenadeNodes = new Map();
let seenEventIds = new Set();
let renderedProfileKey = '';
let feedbackTimer = null;
let feedbackArtTimer = null;
let feedbackSequence = 0;
let motionFrame = null;
let motionWaveId = null;
let motionOffset = 0;
let drawnMotionOffset = 0;
let frozenMotion = null;

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function setMessage(element, text, type = '') {
  setText(element, text);
  element.className = type ? 'message message-' + type : 'message';
}

function setConnection(text, state = 'ready') {
  setText(elements.connectionStatus, text);
  elements.connectionStatus.dataset.state = state;
}

function getActivePlayer() {
  return players.find((player) => player.id === activePlayerId);
}

function isFinished(value = run) {
  return Boolean(value && (value.status === 'won' || value.status === 'lost'));
}

function isRunLocked() {
  return Boolean(pendingAction || (run && !isFinished()) || (knownRunId && !run));
}

function validID(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidPlayer(player) {
  return player && validID(player.id) && typeof player.name === 'string' &&
    player.name.trim().length > 0 && player.name.length <= 24 &&
    ['runsPlayed', 'runsWon', 'runsLost', 'bestScore', 'bestPizzaCount', 'totalPizzasCompleted']
      .every((key) => isCount(player[key])) && player.runsPlayed === player.runsWon + player.runsLost &&
    (player.previousBestScore === null || isCount(player.previousBestScore));
}

function isValidPizza(pizza) {
  if (!pizza || !validID(pizza.id) || ![10, 12, 14].includes(pizza.pizzaSize) ||
      pizza.requiredSlices !== ({ 10: 4, 12: 6, 14: 8 })[pizza.pizzaSize] ||
      pizza.requiredCuts !== pizza.requiredSlices / 2 ||
      ![pizza.x, pizza.y, pizza.radius].every(Number.isFinite) || pizza.radius !== 3 * pizza.pizzaSize ||
      !Array.isArray(pizza.cutAngles) || pizza.cutAngles.length > pizza.requiredCuts ||
      !pizza.cutAngles.every((angle) => Number.isFinite(angle) && angle >= 0 && angle < 180) ||
      pizza.currentSlices !== (pizza.cutAngles.length * 2 || 1)) return false;
  const grenade = pizza.grenade;
  return grenade === null || Boolean(grenade &&
    [grenade.x, grenade.y, grenade.radius, grenade.appearsAt, grenade.disappearsAt].every(Number.isFinite) &&
    grenade.radius > 0 && grenade.disappearsAt > grenade.appearsAt);
}

function isValidRun(value) {
  return value && validID(value.id) && validID(value.playerId) &&
    ['countdown', 'playing', 'won', 'lost'].includes(value.status) &&
    ['score', 'pizzasCompleted', 'pizzasSpoiled', 'grenadesHit', 'pizzasMissed', 'bestBefore', 'targetScore', 'waveIndex']
      .every((key) => isCount(value[key])) && value.targetScore === value.bestBefore + 1 &&
    [value.startsAt, value.endsAt, value.serverTime, value.remainingMs, value.countdownMs, value.waveStartsAt, value.waveEndsAt].every(Number.isFinite) &&
    value.endsAt > value.startsAt && value.remainingMs >= 0 && value.countdownMs >= 0 &&
    (value.elapsedMs === null || (Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0)) &&
    value.pizzaCountsBySize && ['10', '12', '14'].every((size) => isCount(value.pizzaCountsBySize[size])) &&
    validID(value.waveId) && value.waveEndsAt > value.waveStartsAt && [1, 2, 3].includes(value.difficultyLevel) &&
    Array.isArray(value.pizzas) && value.pizzas.length <= 3 && value.pizzas.every(isValidPizza) &&
    Array.isArray(value.lastEvents) && value.lastEvents.every((event) => event && validID(event.id) &&
      ['completed', 'spoiled', 'grenade', 'missed'].includes(event.outcome) && isValidPizza(event.pizza));
}

// 3. RECOVERY: a retried cut keeps the original request ID, batch ID, and stroke.
function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 200 && Math.abs(point.y) <= 200;
}

function validStoredAction(action) {
  if (!action || !validID(action.playerId)) return false;
  if (action.kind === 'start') return validID(action.requestId);
  if (action.kind === 'refresh') return validID(action.runId);
  return action.kind === 'cut' && validID(action.runId) && validID(action.waveId) &&
    validID(action.requestId) && validPoint(action.start) && validPoint(action.end);
}

function readRecovery() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(recoveryKey));
    if (!saved || typeof saved !== 'object') return;
    activePlayerId = validID(saved.playerId) ? saved.playerId : null;
    knownRunId = validID(saved.runId) ? saved.runId : null;
    pendingAction = validStoredAction(saved.pendingAction) ? saved.pendingAction : null;
    if (pendingAction) {
      activePlayerId = pendingAction.playerId;
      if (pendingAction.kind !== 'start') knownRunId = pendingAction.runId;
    }
  } catch {
    // Blocked browser storage does not prevent play in the current tab.
  }
}

function saveRecovery() {
  try {
    sessionStorage.setItem(recoveryKey, JSON.stringify({
      playerId: activePlayerId, runId: knownRunId, pendingAction: pendingAction
    }));
  } catch {
    // The server still keeps the run and its original deadline.
  }
}

function stopClock() {
  if (clockInterval !== null) clearInterval(clockInterval);
  clockInterval = null;
}

function clearFeedback() {
  clearTimeout(feedbackTimer);
  clearTimeout(feedbackArtTimer);
  elements.scoreFeedback.classList.remove('is-visible');
  elements.pizzaFeedbackLayer.replaceChildren();
}

function clearRun() {
  stopClock();
  cancelPointerStroke();
  clearFeedback();
  run = null;
  resetBatchMotion();
  knownRunId = null;
  pendingAction = null;
  clockAnchor = null;
  announcedCountdown = null;
  announcedHazards = '';
  seenEventIds = new Set();
  selectedPizzaId = null;
  checkedBoundaries = new Set();
}

// 4. AJAX: profiles use CRUD; every game change is a run API request.
async function requestJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: options.body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    if (response.status === 204) return null;
    let result;
    try { result = await response.json(); }
    catch { throw new Error('The server response could not be read.'); }
    if (!response.ok) {
      const error = new Error(typeof result.error === 'string' ? result.error : 'The request could not be confirmed.');
      error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The connection took too long.');
    if (error instanceof TypeError) throw new Error('Could not reach the server.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function runRequest(action) {
  if (action.kind === 'start') {
    return requestJSON('/api/runs', {
      method: 'POST', body: { playerId: action.playerId, requestId: action.requestId }
    });
  }
  const url = '/api/runs/' + encodeURIComponent(action.runId);
  if (action.kind === 'cut') {
    return requestJSON(url + '/cuts', {
      method: 'POST',
      body: { requestId: action.requestId, waveId: action.waveId, start: action.start, end: action.end }
    });
  }
  return requestJSON(url);
}

function applyEnvelope(envelope, action) {
  if (!envelope || !isValidRun(envelope.run) || !isValidPlayer(envelope.player) ||
      envelope.run.playerId !== envelope.player.id || envelope.run.playerId !== action.playerId ||
      (action.kind !== 'start' && envelope.run.id !== action.runId)) {
    throw new Error('The run response could not be read.');
  }
  const previousRun = run;
  const outcomeOffset = action.kind === 'cut' && envelope.run.status === 'playing' &&
    previousRun?.waveId === envelope.run.waveId &&
    frozenMotion?.waveId === envelope.run.waveId ? frozenMotion.offset : 0;
  if (!previousRun || previousRun.id !== envelope.run.id) {
    checkedBoundaries = new Set();
    announcedCountdown = null;
    announcedHazards = '';
    seenEventIds = new Set();
    selectedPizzaId = null;
    elements.bladeAngle.value = '0';
    clearFeedback();
  }
  cancelPointerStroke();
  run = envelope.run;
  knownRunId = run.id;
  activePlayerId = run.playerId;
  clockAnchor = { serverTime: run.serverTime, receivedAt: performance.now() };
  const exists = players.some((player) => player.id === envelope.player.id);
  players = exists ? players.map((player) => player.id === envelope.player.id ? envelope.player : player) : [...players, envelope.player];
  pendingAction = null;
  requestFailure = '';
  if (isFinished()) {
    stopClock();
    const outcome = run.status === 'won'
      ? 'You win! ' + run.score + ' points beats your starting best of ' + run.bestBefore + '.'
      : 'Run finished. ' + run.score + ' points did not beat your starting best of ' + run.bestBefore + '. This run is a loss.';
    setMessage(elements.gameMessage, outcome + ' Your result is saved.', run.status === 'won' ? 'success' : '');
    setMessage(elements.playerMessage, 'Your score and run record are saved. Ready for another minute?');
    setConnection('Run saved');
    elements.countdownAnnouncement.textContent = '';
  } else {
    if (clockInterval === null) clockInterval = setInterval(tickClock, 50);
    const feedback = typeof envelope.feedback === 'string' && envelope.feedback.trim()
      ? envelope.feedback : (run.status === 'countdown' ? 'Get ready for your first batch.' : 'Cut through the centres and make evenly sized slices.');
    setMessage(elements.gameMessage, feedback);
    setMessage(elements.playerMessage, 'Finish this run before changing your profile.');
    setConnection(run.status === 'countdown' ? 'Run ready' : 'Run in progress');
    if (previousRun?.status === 'countdown' && run.status === 'playing') {
      elements.countdownAnnouncement.textContent = 'Go! Your one-minute rush has started.';
    }
  }
  const freshEvents = run.lastEvents.filter((event) => !seenEventIds.has(event.id));
  run.lastEvents.forEach((event) => seenEventIds.add(event.id));
  if (previousRun?.id === run.id && freshEvents.length > 0) showPizzaFeedback(freshEvents, outcomeOffset);
  saveRecovery();
}

async function performRunAction(action) {
  if (busy || !loaded) return;
  const previousFocus = document.activeElement;
  busy = true;
  requestFailure = '';
  if (action.kind === 'cut') clearPointerStroke();
  else cancelPointerStroke();
  // Copy now so future pointer movement cannot change an uncertain request.
  pendingAction = JSON.parse(JSON.stringify(action));
  saveRecovery();
  setConnection(action.kind === 'cut' ? 'Checking your cut…' : (action.kind === 'start' ? 'Preparing your run…' : 'Checking your run…'), 'loading');
  renderInterface();
  try {
    const envelope = await runRequest(pendingAction);
    applyEnvelope(envelope, action);
  } catch (error) {
    requestFailure = error.message;
    if (error.status === 404) {
      clearRun();
      setMessage(elements.gameMessage, 'That profile or run is no longer available. Use Reload & recover to check your profiles.', 'error');
    } else {
      // These responses reject the request. Network/5xx failures stay pending.
      if ([400, 405, 409, 413].includes(error.status)) pendingAction = null;
      setMessage(elements.gameMessage, error.message + ' The action has not been confirmed. ' +
        (pendingAction ? 'Retry the same action, or use Reload & recover.' : 'Use Check run or Reload & recover to check your saved progress.'), 'error');
    }
    setConnection('Action not confirmed', 'error');
    saveRecovery();
  } finally {
    busy = false;
    releaseBatchMotion();
    renderInterface();
    if (pendingAction) elements.retryAction.focus({ preventScroll: true });
    else if (isFinished()) elements.startRun.focus({ preventScroll: true });
    else if (action.origin === 'keyboard' && run && !isFinished()) elements.pizzaBoard.focus({ preventScroll: true });
    else if (action.kind === 'start' && run) elements.pizzaBoard.focus({ preventScroll: true });
    else if (previousFocus === elements.bladeAngle && !elements.bladeAngle.disabled) elements.bladeAngle.focus({ preventScroll: true });
    else if (previousFocus === elements.targetPizza && !elements.targetPizza.disabled) elements.targetPizza.focus({ preventScroll: true });
    else if (previousFocus === elements.cutAngle && canCut()) elements.cutAngle.focus({ preventScroll: true });
    // A request can cross a deadline. Reconcile once after it settles.
    tickClock();
  }
}

// 5. CLOCK: interpolate both displays; only the server changes a batch/result.
function estimatedServerTime() {
  return clockAnchor ? clockAnchor.serverTime + performance.now() - clockAnchor.receivedAt : 0;
}

function phaseRemaining() {
  if (!run) return rules.runDurationMs;
  if (isFinished()) return 0;
  return Math.max(0, (run.status === 'countdown' ? run.startsAt : run.endsAt) - estimatedServerTime());
}

function waveRemaining() {
  if (!run) return rules.waveDurationMs;
  if (isFinished()) return 0;
  if (run.status === 'countdown') return run.waveEndsAt - run.waveStartsAt;
  return Math.max(0, Math.min(run.waveEndsAt, run.endsAt) - estimatedServerTime());
}

function boundaryKey() {
  if (!run || isFinished()) return null;
  if (run.status === 'countdown') return phaseRemaining() <= 0 ? run.id + ':preparation' : null;
  if (phaseRemaining() <= 0) return run.id + ':end';
  return waveRemaining() <= 0 ? run.id + ':batch:' + run.waveId : null;
}

function canCut() {
  return Boolean(loaded && !busy && !pendingAction && run?.status === 'playing' &&
    run.pizzas.length > 0 && phaseRemaining() > 0 && waveRemaining() > 0 && !document.hidden);
}

function canAim() {
  return Boolean(loaded && !busy && !pendingAction && run && !isFinished() &&
    run.pizzas.length > 0 && phaseRemaining() > 0 && waveRemaining() > 0);
}

function secondsRemaining(milliseconds) {
  // Round up so a positive remainder never looks like an expired clock.
  return (Math.ceil(Math.max(0, milliseconds) / 100) / 10).toFixed(1);
}

function pizzaPosition(pizza) {
  const horizontal = pizza.x < -1 ? 'left' : (pizza.x > 1 ? 'right' : 'centre');
  return (pizza.y < -1 ? 'upper ' : (pizza.y > 1 ? 'lower ' : '')) + horizontal;
}

function renderHazards() {
  const now = estimatedServerTime();
  const activePizzas = [];
  (run?.pizzas || []).forEach((pizza) => {
    const grenade = pizza.grenade;
    const active = Boolean(grenade && run.status === 'playing' && now >= grenade.appearsAt &&
      now < grenade.disappearsAt && now < run.waveEndsAt && now < run.endsAt);
    grenadeNodes.get(pizza.id)?.setAttribute('visibility', active ? 'visible' : 'hidden');
    if (active) activePizzas.push(pizza);
  });
  elements.hazardStatus.dataset.active = String(activePizzas.length > 0);
  const hazardKey = activePizzas.map((pizza) => pizza.id).join(',');
  if (activePizzas.length > 0) {
    const remaining = Math.max(...activePizzas.map((pizza) => pizza.grenade.disappearsAt - now));
    setText(elements.hazardStatus, activePizzas.length + (activePizzas.length === 1 ? ' grenade · ' : ' grenades · ') + secondsRemaining(remaining) + ' s');
    if (hazardKey !== announcedHazards) {
      elements.hazardAnnouncement.textContent = 'Active grenade on ' + activePizzas.map((pizza) =>
        'the ' + pizza.pizzaSize + '-inch ' + pizzaPosition(pizza) + ' pizza').join(' and ') + '. Avoid it until it disappears.';
    }
  } else {
    setText(elements.hazardStatus, !run || isFinished() ? 'Watch for grenades during your run' :
      (run.status === 'countdown' ? 'Grenades may appear when play starts' : 'No active grenade'));
    if (announcedHazards && run?.status === 'playing') elements.hazardAnnouncement.textContent = 'No active grenades remain.';
  }
  announcedHazards = hazardKey;
}

function renderClock() {
  const remaining = phaseRemaining();
  const countdown = run?.status === 'countdown';
  const key = boundaryKey();
  const finalBoundary = Boolean(run && !countdown && remaining <= 0 && !isFinished());
  setText(elements.timerLabel, countdown ? 'Get ready' : 'Time left');
  setText(elements.timerDisplay, countdown ? Math.ceil(remaining / 1000) : secondsRemaining(remaining));
  elements.timerProgress.max = countdown ? Math.max(1, run.countdownMs)
    : Math.max(1, run ? run.endsAt - run.startsAt : rules.runDurationMs);
  elements.timerProgress.value = remaining;
  elements.timerProgress.setAttribute('aria-valuetext', secondsRemaining(remaining) + ' seconds remaining');
  elements.runTimer.dataset.state = run?.status || 'ready';
  elements.runTimer.dataset.urgent = String(run?.status === 'playing' && remaining <= 10000);
  elements.runStatus.dataset.state = run?.status || 'ready';
  elements.pizzaBoard.dataset.state = run?.status || 'ready';

  const batchTime = countdown ? remaining : waveRemaining();
  setText(elements.batchLabel, countdown ? 'First batch in' : (run && !isFinished() && run.pizzas.length === 0 ? 'Next batch in' : 'Batch ends in'));
  setText(elements.batchTimer, secondsRemaining(batchTime));
  elements.batchProgress.max = countdown ? Math.max(1, run.countdownMs)
    : Math.max(1, run ? run.waveEndsAt - run.waveStartsAt : rules.waveDurationMs);
  elements.batchProgress.value = batchTime;
  elements.batchProgress.setAttribute('aria-valuetext', secondsRemaining(batchTime) + ' seconds until the batch changes');

  let overlay = '';
  if (!loaded) overlay = requestFailure ? 'Reload & recover to reconnect.' : 'Getting the arcade ready…';
  else if (pendingAction && requestFailure) overlay = 'Waiting for confirmation · use Retry';
  else if (!run) overlay = busy ? 'Preparing your run…' : (getActivePlayer() ? 'Ready? Start your one-minute rush.' : 'Create a profile below to get started.');
  else if (isFinished()) overlay = run.status === 'won' ? 'New personal best!' : 'Minute complete · try again';
  else if (countdown && remaining > 0) overlay = 'Ready in ' + Math.ceil(remaining / 1000);
  else if (key) overlay = countdown ? 'Starting the run…' : (finalBoundary ? 'Checking final result…' : 'Checking the next batch…');
  else if (run.pizzas.length === 0) overlay = 'Board clear · next batch in ' + secondsRemaining(waveRemaining()) + ' s';
  else if (busy) overlay = 'Checking your cut…';
  elements.boardOverlay.hidden = !overlay;
  setText(elements.boardOverlayText, overlay);
  setText(elements.runStatus, !loaded ? 'Getting ready' : (!run ? (busy ? 'Preparing run' : 'Ready when you are') :
    (isFinished() ? (run.status === 'won' ? 'Win · new best' : 'Loss · best stands') :
      (key ? (finalBoundary ? 'Checking result' : 'Checking batch') : (countdown ? 'Get ready' : 'Keep slicing')))));

  if (countdown) {
    const seconds = Math.ceil(remaining / 1000);
    if (seconds > 0 && announcedCountdown !== seconds) {
      announcedCountdown = seconds;
      elements.countdownAnnouncement.textContent = 'Get ready. ' + seconds + (seconds === 1 ? ' second.' : ' seconds.');
    }
  }
  const interactive = canCut();
  elements.pizzaBoard.setAttribute('aria-disabled', String(!interactive));
  elements.cutAngle.disabled = !interactive;
  elements.bladeAngle.disabled = !canAim();
  elements.targetPizza.disabled = !canAim();
  elements.checkRun.hidden = !run || isFinished() || Boolean(pendingAction) ||
    (!requestFailure && !(key && checkedBoundaries.has(key)));
  elements.checkRun.disabled = busy;
  if (!interactive && pointerStroke) cancelPointerStroke();
  if (!canAim()) elements.bladeLayer.setAttribute('visibility', 'hidden');
  renderHazards();
  renderBatchMotion();
}

function tickClock() {
  renderClock();
  const key = boundaryKey();
  if (!key || busy || pendingAction || checkedBoundaries.has(key)) return;
  // One automatic GET per preparation, batch, or run deadline; no timer polling.
  checkedBoundaries.add(key);
  void performRunAction({ kind: 'refresh', playerId: run.playerId, runId: run.id, origin: 'phase' });
}

// One shared translation keeps pizza art, hazards, labels, and blade together.
function stopMotionFrame() {
  if (motionFrame !== null) cancelAnimationFrame(motionFrame);
  motionFrame = null;
}

function drawBatchOffset(offset) {
  if (offset === drawnMotionOffset) return;
  elements.batchMotion.setAttribute('transform', 'translate(' + offset + ' 0)');
  drawnMotionOffset = offset;
}

function resetBatchMotion() {
  stopMotionFrame();
  frozenMotion = null;
  motionWaveId = null;
  motionOffset = 0;
  drawBatchOffset(0);
}

function renderBatchMotion() {
  if (!run || isFinished()) { resetBatchMotion(); return; }
  if (motionWaveId !== run.waveId) {
    stopMotionFrame();
    frozenMotion = null;
    motionWaveId = run.waveId;
    motionOffset = -BATCH_ENTRY_DISTANCE;
  }
  const now = estimatedServerTime();
  if (frozenMotion?.waveId === run.waveId && now < run.waveEndsAt && !reducedMotion.matches) {
    stopMotionFrame();
    drawBatchOffset(frozenMotion.offset);
    return;
  }
  frozenMotion = null;
  const preparationEntry = run.waveIndex === 0 ? Math.min(BATCH_ENTRY_MS, rules.preparationMs) : 0;
  const duration = preparationEntry || BATCH_ENTRY_MS;
  const elapsed = (now - (run.waveStartsAt - preparationEntry)) * BATCH_ENTRY_MS / duration;
  // Same-wave responses cannot move the entrance backwards or replay it.
  motionOffset = Math.max(motionOffset, entranceOffset(elapsed, reducedMotion.matches));
  drawBatchOffset(motionOffset);
  if (!document.hidden && !reducedMotion.matches && elapsed >= 0 && elapsed < BATCH_ENTRY_MS && motionOffset < 0) {
    if (motionFrame === null) motionFrame = requestAnimationFrame(() => {
      motionFrame = null;
      renderBatchMotion();
    });
  } else stopMotionFrame();
}

function freezeBatchMotion() {
  // Hold the last drawn position before reading the group's inverse matrix.
  stopMotionFrame();
  frozenMotion = { waveId: run.waveId, offset: drawnMotionOffset };
}

function releaseBatchMotion() {
  frozenMotion = null;
  renderBatchMotion();
}

// 6. RENDER: safe profile text, several SVG pizzas, and confirmed cut lines.
function sortProfilesByName(profileList) {
  return [...profileList].sort((first, second) => first.name.localeCompare(second.name) || first.id.localeCompare(second.id));
}

function renderProfiles(profileList) {
  const key = JSON.stringify(profileList.map((player) => [player.id, player.name]));
  if (key !== renderedProfileKey) {
    const options = profileList.map((player) => {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      return option;
    });
    if (options.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'Create a profile first';
      options.push(empty);
    }
    elements.playerSelect.replaceChildren(...options);
    renderedProfileKey = key;
  }
  elements.playerSelect.value = activePlayerId || '';
  const player = getActivePlayer();
  const locked = !loaded || busy || isRunLocked();
  elements.playerSelect.disabled = locked || !player;
  elements.editProfile.disabled = locked || !player;
  elements.deleteProfile.disabled = locked || !player;
  setText(elements.profileBestScore, player?.bestScore || 0);
  setText(elements.profileBestPizzas, player?.bestPizzaCount || 0);
  setText(elements.profileRunsPlayed, player?.runsPlayed || 0);
  setText(elements.profileTotalPizzas, player?.totalPizzasCompleted || 0);
  setText(elements.profileRunsWon, player?.runsWon || 0);
  setText(elements.profileRunsLost, player?.runsLost || 0);
  elements.previousBestRecord.hidden = !player || player.previousBestScore === null;
  setText(elements.previousBestScore, player?.previousBestScore || 0);
  elements.playerName.disabled = locked;
  elements.playerSubmit.disabled = locked;
  elements.cancelEdit.disabled = locked;
  elements.cancelEdit.hidden = !editingPlayerId;
  setText(elements.playerSubmit, editingPlayerId ? 'Save name' : 'Add profile');
  setText(elements.playerFormTitle, editingPlayerId ? 'Rename profile' : 'Add a profile');
  setText(elements.profileEditorTitle, editingPlayerId ? 'Rename profile' : 'Add a profile');
  elements.confirmDelete.disabled = busy;
  elements.cancelDelete.disabled = busy;
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(svgNamespace, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function makeCutLine(angle, className) {
  const stroke = strokeForAngle(angle, 1);
  return svgElement('line', {
    x1: stroke.start.x * 100, y1: stroke.start.y * 100,
    x2: stroke.end.x * 100, y2: stroke.end.y * 100, class: className
  });
}

function renderTargets(pizzas) {
  if (!pizzas.some((pizza) => pizza.id === selectedPizzaId)) selectedPizzaId = pizzas[0]?.id || null;
  const key = pizzas.map((pizza) => pizza.id).join(',');
  if (key !== renderedTargetKey) {
    const options = pizzas.map((pizza) => {
      const option = document.createElement('option');
      option.value = pizza.id;
      option.textContent = pizza.pizzaSize + '″ · ' + pizzaPosition(pizza) + ' · ' + pizza.requiredSlices + ' slices';
      return option;
    });
    if (options.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No pizza on the board';
      options.push(empty);
    }
    elements.targetPizza.replaceChildren(...options);
    renderedTargetKey = key;
  }
  elements.targetPizza.value = selectedPizzaId || '';
}

function renderPizzas() {
  const pizzas = run?.pizzas || [];
  const signature = JSON.stringify([run?.id, run?.waveId, run?.status, pizzas.map((pizza) => [pizza.id, pizza.cutAngles])]);
  if (renderedPizzaKey === signature) return;
  elements.pizzasLayer.replaceChildren();
  elements.grenadesLayer.replaceChildren();
  grenadeNodes = new Map();
  pizzas.forEach((pizza) => {
    const previous = renderedPizzas.find((item) => item.id === pizza.id);
    const group = svgElement('g', { transform: 'translate(' + pizza.x + ' ' + pizza.y + ') scale(' + pizza.radius / 100 + ')' });
    group.append(copyPizzaArt());
    // Only angles already accepted by the API are drawn on the pizza.
    pizza.cutAngles.forEach((angle) => {
      const fresh = previous && !previous.cutAngles.includes(angle);
      group.append(makeCutLine(angle, 'pizza-cut-shadow'));
      group.append(makeCutLine(angle, 'pizza-cut' + (fresh ? ' is-fresh' : '')));
    });
    elements.pizzasLayer.append(group);
    const label = svgElement('text', { x: pizza.x, y: pizza.y + pizza.radius + 14, 'text-anchor': 'middle', class: 'pizza-size-label' });
    label.textContent = pizza.pizzaSize + '″ · ' + pizza.requiredSlices + ' slices';
    const progress = svgElement('text', { x: pizza.x, y: pizza.y + pizza.radius + 25, 'text-anchor': 'middle', class: 'pizza-progress-label' });
    progress.textContent = pizza.cutAngles.length + '/' + pizza.requiredCuts + ' cuts · ' + pizza.currentSlices + '/' + pizza.requiredSlices + ' slices';
    elements.pizzasLayer.append(label, progress);
    if (pizza.grenade) {
      const grenade = pizza.grenade;
      const sprite = elements.grenadeArtTemplate.cloneNode(true);
      sprite.removeAttribute('id');
      sprite.setAttribute('class', 'grenade-sprite');
      sprite.setAttribute('transform', 'translate(' + grenade.x + ' ' + grenade.y + ') scale(' + grenade.radius / 20 + ')');
      sprite.setAttribute('visibility', 'hidden');
      elements.grenadesLayer.append(sprite);
      grenadeNodes.set(pizza.id, sprite);
    }
  });
  const quantity = run ? DIFFICULTY_LEVELS.find((level) => level.level === run.difficultyLevel).pizzasPerWave : 0;
  setText(elements.batchTitle, run ? 'Batch ' + (run.waveIndex + 1) + ' of 12' : 'Fresh pizzas every ' + rules.waveDurationMs / 1000 + ' seconds');
  setText(elements.difficultyDisplay, run ? 'Level ' + run.difficultyLevel + ' · ' + quantity + (quantity === 1 ? ' pizza' : ' pizzas') : 'Level —');
  elements.difficultyDisplay.dataset.level = run ? String(run.difficultyLevel) : '';
  setText(elements.boardSummary, !run ? 'Your first batch is waiting' : (isFinished() ? 'Run complete' :
    (pizzas.length ? pizzas.length + (pizzas.length === 1 ? ' pizza remaining' : ' pizzas remaining') : 'Batch cleared')));
  elements.pizzaBoard.setAttribute('aria-label', pizzas.length ? pizzas.map((pizza) =>
    pizza.pizzaSize + '-inch pizza, ' + pizzaPosition(pizza) + '. ' + pizza.requiredSlices + ' slices needed; ' +
    pizza.cutAngles.length + ' of ' + pizza.requiredCuts + ' cuts made.' +
    (pizza.cutAngles.length ? ' Cuts made at ' + pizza.cutAngles.map((angle) => Math.round(angle) + ' degrees').join(', ') + '.' : ' Your first cut sets the direction.')
  ).join(' ') : 'Pizza board. ' + (run && !isFinished() ? 'Wait for the next batch.' : 'Create or choose a profile, then start a run.'));
  renderTargets(pizzas);
  renderedPizzas = [...pizzas];
  renderedPizzaKey = signature;
}

function renderRules() {
  setText(elements.completePoints, '+' + SCORE_RULES.completedPizza);
  setText(elements.wrongPenalty, '−' + SCORE_RULES.wrongCut);
  setText(elements.grenadePenalty, '−' + SCORE_RULES.grenade);
  setText(elements.missedPenalty, '−' + SCORE_RULES.missedPizza);
  const preparation = rules.preparationMs > 0 ? rules.preparationMs / 1000 + ' seconds to prepare, then ' : 'Start straight into ';
  const levels = DIFFICULTY_LEVELS.map((level, index) => level.pizzasPerWave + (level.pizzasPerWave === 1 ? ' pizza' : ' pizzas') +
    (index === 0 ? ' at first' : ' after ' + level.startsAfterMs / 1000 + ' seconds')).join(', ');
  setText(elements.timingSummary, preparation + 'a full ' + rules.runDurationMs / 1000 + ' seconds. Fresh batches slide in from the left every ' + rules.waveDurationMs / 1000 + ' seconds: ' + levels + '.');
  elements.sizeRules.replaceChildren(...rules.pizzas.map((pizza) => {
    const item = document.createElement('li');
    const size = document.createElement('strong');
    size.textContent = pizza.sizeInches + '″';
    const slices = document.createElement('span');
    const cuts = pizza.slices / 2;
    const name = ({ 10: 'Small', 12: 'Medium', 14: 'Large' })[pizza.sizeInches];
    slices.textContent = name + ' · ' + pizza.slices + ' slices · ' + cuts + ' cuts, ' + 180 / cuts + '° apart';
    item.append(size, slices);
    return item;
  }));
}

function renderInterface() {
  // Function composition: the helper's returned array becomes renderer input.
  renderProfiles(sortProfilesByName(players));
  const player = getActivePlayer();
  setText(elements.activePlayerName, player?.name || 'Choose a profile');
  setText(elements.scoreDisplay, run?.score || 0);
  setText(elements.bestToBeat, run ? run.bestBefore : (player?.bestScore || 0));
  setText(elements.pizzasCompleted, run?.pizzasCompleted || 0);
  setText(elements.pizzasSpoiled, run?.pizzasSpoiled || 0);
  setText(elements.grenadesHit, run?.grenadesHit || 0);
  setText(elements.pizzasMissed, run?.pizzasMissed || 0);
  elements.startRun.disabled = !loaded || busy || !player || isRunLocked() || Boolean(editingPlayerId);
  setText(elements.startRun, isFinished() ? 'Play another minute' : 'Start run');
  elements.createProfileShortcut.hidden = Boolean(player);
  elements.createProfileShortcut.disabled = !loaded || busy;
  elements.retryAction.hidden = !pendingAction || busy;
  elements.retryAction.disabled = busy;
  setText(elements.retryAction, pendingAction?.kind === 'cut' ? 'Retry cut' : (pendingAction?.kind === 'start' ? 'Retry start' : 'Retry check'));
  elements.reloadPlayers.hidden = loaded && !requestFailure;
  elements.reloadPlayers.disabled = busy;
  elements.resultBanner.hidden = !isFinished();
  if (isFinished()) {
    elements.resultBanner.dataset.state = run.status;
    setText(elements.resultTitle, run.status === 'won' ? 'New personal best!' : 'Time’s up. Go again?');
    setText(elements.resultDetail, run.score + ' points · ' + run.pizzasCompleted + ' pizzas completed. ' +
      (run.status === 'won' ? 'You beat your starting best of ' + run.bestBefore + '.' :
        'Beat your starting best of ' + run.bestBefore + ' to win. Ties count as a loss.'));
  }
  renderPizzas();
  renderClock();
  renderBlade();
}

// 7. FEEDBACK: event IDs prevent replays when the API returns the same history.
function copyPizzaArt() {
  const art = elements.wholePizzaArt.cloneNode(true);
  art.removeAttribute('id');
  return art;
}

function showPizzaFeedback(events, offset = 0) {
  clearFeedback();
  const counts = { completed: 0, spoiled: 0, grenade: 0, missed: 0 };
  events.forEach((event) => { counts[event.outcome] += 1; });
  const labels = [];
  if (counts.completed) labels.push('+' + counts.completed * SCORE_RULES.completedPizza + ' · ' + counts.completed + ' complete');
  if (counts.spoiled) labels.push('−' + counts.spoiled * SCORE_RULES.wrongCut + ' · ' + counts.spoiled + ' wrong cut');
  if (counts.grenade) labels.push('−' + counts.grenade * SCORE_RULES.grenade + ' · ' + counts.grenade + ' grenade');
  if (counts.missed) labels.push('−' + counts.missed * SCORE_RULES.missedPizza + ' · ' + counts.missed + ' missed');
  const label = labels.join(' / ');
  elements.scoreFeedback.textContent = label;
  elements.scoreFeedback.dataset.outcome = counts.grenade ? 'grenade' : (counts.spoiled ? 'spoiled' : (counts.missed ? 'missed' : 'completed'));
  elements.scoreFeedback.classList.add('is-visible');
  feedbackTimer = setTimeout(() => elements.scoreFeedback.classList.remove('is-visible'), 800);
  if (reducedMotion.matches) return;
  // A late refresh can report many missed batches; keep the visual effect brief.
  events.slice(-3).forEach(({ pizza, outcome }) => {
    const wrapper = svgElement('g', { transform: 'translate(' + (pizza.x + offset) + ' ' + pizza.y + ') scale(' + pizza.radius / 100 + ')' });
    elements.pizzaFeedbackLayer.append(wrapper);
    if (outcome === 'completed') {
      const angles = pizza.cutAngles.flatMap((angle) => [angle, angle + 180]).sort((a, b) => a - b);
      const definitions = svgElement('defs');
      wrapper.append(definitions);
      feedbackSequence += 1;
      angles.forEach((start, index) => {
        const end = angles[(index + 1) % angles.length] + (index === angles.length - 1 ? 360 : 0);
        const first = { x: Math.cos(start * Math.PI / 180) * 112, y: Math.sin(start * Math.PI / 180) * 112 };
        const last = { x: Math.cos(end * Math.PI / 180) * 112, y: Math.sin(end * Math.PI / 180) * 112 };
        const clipID = 'rush-slice-' + feedbackSequence + '-' + index;
        const clip = svgElement('clipPath', { id: clipID });
        clip.append(svgElement('path', { d: 'M 0 0 L ' + first.x + ' ' + first.y + ' A 112 112 0 0 1 ' + last.x + ' ' + last.y + ' Z' }));
        definitions.append(clip);
        const slice = svgElement('g', { class: 'feedback-slice' });
        const middle = (start + end) / 2 * Math.PI / 180;
        slice.style.setProperty('--slice-x', Math.cos(middle) * 18 + 'px');
        slice.style.setProperty('--slice-y', Math.sin(middle) * 18 + 'px');
        const clippedArt = svgElement('g', { 'clip-path': 'url(#' + clipID + ')' });
        clippedArt.append(copyPizzaArt());
        slice.append(clippedArt);
        wrapper.append(slice);
      });
    } else {
      const art = copyPizzaArt();
      art.setAttribute('class', 'feedback-' + outcome);
      wrapper.append(art);
      if (outcome === 'grenade' && pizza.grenade) {
        art.append(svgElement('circle', { cx: (pizza.grenade.x - pizza.x) * 100 / pizza.radius,
          cy: (pizza.grenade.y - pizza.y) * 100 / pizza.radius, r: 30,
          fill: '#ffc95d', 'fill-opacity': 0.7, stroke: '#b53c29', 'stroke-width': 4 }));
      }
    }
  });
  feedbackArtTimer = setTimeout(() => elements.pizzaFeedbackLayer.replaceChildren(), 300);
}

// 8. INPUT: world-coordinate strokes keep the batch ID they began on.
function paintBlade(stroke) {
  [elements.bladeShadow, elements.bladeLine].forEach((line) => {
    line.setAttribute('x1', stroke.start.x);
    line.setAttribute('y1', stroke.start.y);
    line.setAttribute('x2', stroke.end.x);
    line.setAttribute('y2', stroke.end.y);
  });
  elements.bladeLayer.setAttribute('visibility', 'visible');
}

function getTargetPizza() {
  return run?.pizzas.find((pizza) => pizza.id === selectedPizzaId);
}

function renderBlade() {
  setText(elements.bladeAngleValue, elements.bladeAngle.value + '°');
  elements.bladeAngle.setAttribute('aria-valuetext', elements.bladeAngle.value + ' degrees');
  const pizza = getTargetPizza();
  if (pointerStroke) paintBlade(pointerStroke);
  else if (elements.keyboardControls.open && canAim() && pizza) paintBlade(strokeForPizza(pizza, Number(elements.bladeAngle.value)));
  else elements.bladeLayer.setAttribute('visibility', 'hidden');
}

function pointerPoint(event) {
  const matrix = elements.batchMotion.getScreenCTM();
  if (!matrix || !run) return null;
  const point = elements.pizzaSVG.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  // The frozen batch matrix removes both screen scaling and its entrance offset.
  const local = point.matrixTransform(matrix.inverse());
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? { x: local.x, y: local.y } : null;
}

function clearPointerStroke() {
  const pointerID = pointerStroke?.pointerId;
  pointerStroke = null;
  if (pointerID !== undefined && elements.pizzaBoard.hasPointerCapture(pointerID)) elements.pizzaBoard.releasePointerCapture(pointerID);
  elements.bladeLayer.setAttribute('visibility', 'hidden');
}

function cancelPointerStroke() {
  clearPointerStroke();
  releaseBatchMotion();
}

function handlePointerDown(event) {
  if (!canCut() || !event.isPrimary || event.button !== 0 || pointerStroke) { tickClock(); return; }
  freezeBatchMotion();
  const point = pointerPoint(event);
  if (!point) { releaseBatchMotion(); return; }
  event.preventDefault();
  elements.pizzaBoard.focus({ preventScroll: true });
  pointerStroke = { pointerId: event.pointerId, waveId: run.waveId, start: point, end: point };
  elements.pizzaBoard.setPointerCapture(event.pointerId);
  paintBlade(pointerStroke);
}

function handlePointerMove(event) {
  if (!pointerStroke || pointerStroke.pointerId !== event.pointerId) return;
  if (!canCut() || pointerStroke.waveId !== run?.waveId) { cancelPointerStroke(); tickClock(); return; }
  const point = pointerPoint(event);
  if (!point) return;
  event.preventDefault();
  pointerStroke.end = point;
  paintBlade(pointerStroke);
}

function handlePointerUp(event) {
  if (!pointerStroke || pointerStroke.pointerId !== event.pointerId) return;
  const stroke = pointerStroke;
  const point = pointerPoint(event);
  clearPointerStroke();
  if (!point || !canCut() || stroke.waveId !== run?.waveId) { releaseBatchMotion(); tickClock(); return; }
  event.preventDefault();
  void submitCut({ start: stroke.start, end: point }, stroke.waveId, 'pointer');
}

async function submitCut(stroke, waveId, origin) {
  if (!canCut() || waveId !== run.waveId) { releaseBatchMotion(); tickClock(); return; }
  // Clip the complete pointer segment once; separate endpoint clamps bend cuts.
  // Keyboard strokes and retried request bodies already use canonical bounds.
  const submittedStroke = origin === 'pointer' ? clipStrokeToBounds(stroke) : stroke;
  if (!submittedStroke) { releaseBatchMotion(); return; }
  await performRunAction({ kind: 'cut', playerId: run.playerId, runId: run.id, waveId: waveId,
    requestId: crypto.randomUUID(), start: submittedStroke.start, end: submittedStroke.end, origin: origin });
}

function submitKeyboardCut() {
  const pizza = getTargetPizza();
  if (!canCut() || !pizza) { tickClock(); return; }
  freezeBatchMotion();
  // The selected pizza sets position; the player's chosen angle stays unchanged.
  void submitCut(strokeForPizza(pizza, Number(elements.bladeAngle.value)), run.waveId, 'keyboard');
}

function handleBoardKey(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (!canAim()) { tickClock(); return; }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    elements.keyboardControls.open = true;
    elements.bladeAngle.value = String((Number(elements.bladeAngle.value) + (event.key === 'ArrowRight' ? 5 : 175)) % 180);
    renderBlade();
  } else if (event.key === 'Enter' || event.key === ' ') submitKeyboardCut();
}

function startRun() {
  if (!loaded || busy || !getActivePlayer() || isRunLocked() || editingPlayerId) return;
  clearRun();
  elements.gamePanel.scrollIntoView({ block: 'start' });
  void performRunAction({ kind: 'start', playerId: activePlayerId, requestId: crypto.randomUUID(), origin: 'start' });
}

// 9. PROFILE CRUD: records are read-only here; PATCH changes a name only.
function resetEditor() {
  editingPlayerId = null;
  elements.playerForm.reset();
  elements.playerName.removeAttribute('aria-invalid');
}

function openProfileEditor() {
  elements.profileEditor.open = true;
  elements.playerName.focus();
}

async function handlePlayerSubmit(event) {
  event.preventDefault();
  if (busy || !loaded || isRunLocked()) return;
  const name = elements.playerName.value.trim();
  if (!name || name.length > 24) {
    elements.playerName.setAttribute('aria-invalid', 'true');
    setMessage(elements.playerMessage, 'Enter a name from 1 to 24 characters.', 'error');
    elements.playerName.focus();
    return;
  }
  elements.playerName.removeAttribute('aria-invalid');
  const wasEditing = Boolean(editingPlayerId);
  busy = true;
  requestFailure = '';
  setConnection('Saving profile…', 'loading');
  renderInterface();
  try {
    const player = await requestJSON(wasEditing ? '/api/players/' + encodeURIComponent(editingPlayerId) : '/api/players', {
      method: wasEditing ? 'PATCH' : 'POST', body: { name: name }
    });
    if (!isValidPlayer(player)) throw new Error('The profile response could not be read.');
    if (wasEditing) players = players.map((item) => item.id === player.id ? player : item);
    else { players.push(player); activePlayerId = player.id; clearRun(); }
    resetEditor();
    elements.profileEditor.open = false;
    setMessage(elements.playerMessage, wasEditing ? 'Profile name updated.' : player.name + ' is ready to play.', 'success');
    if (!wasEditing) setMessage(elements.gameMessage, 'Press Start run to reveal your first batch. Your score begins at zero.');
    setConnection('Profile saved');
    saveRecovery();
  } catch (error) {
    requestFailure = error.message;
    setMessage(elements.playerMessage, error.message + ' The change was not confirmed. Reload & recover to check.', 'error');
    setConnection('Change not confirmed', 'error');
  } finally {
    busy = false;
    renderInterface();
    if (requestFailure) elements.playerName.focus();
    else elements.startRun.focus();
  }
}

function handleProfileChange() {
  if (busy || isRunLocked()) return;
  const player = players.find((item) => item.id === elements.playerSelect.value);
  if (!player) return;
  clearRun();
  activePlayerId = player.id;
  requestFailure = '';
  resetEditor();
  elements.profileEditor.open = false;
  setMessage(elements.playerMessage, player.name + ' selected.');
  setMessage(elements.gameMessage, 'Press Start run when you are ready. An unfinished run will resume its original clock.');
  saveRecovery();
  renderInterface();
  elements.startRun.focus();
}

function renameProfile() {
  const player = getActivePlayer();
  if (!player || busy || isRunLocked()) return;
  editingPlayerId = player.id;
  elements.playerName.value = player.name;
  setMessage(elements.playerMessage, 'Change your name, then save it.');
  renderInterface();
  openProfileEditor();
  elements.playerName.select();
}

function requestDeleteProfile() {
  const player = getActivePlayer();
  if (!player || busy || isRunLocked()) return;
  deletingPlayerId = player.id;
  elements.deletePlayerName.textContent = player.name;
  elements.deleteDialog.showModal();
  elements.cancelDelete.focus();
}

async function deletePlayer() {
  if (!deletingPlayerId || busy || isRunLocked()) return;
  const id = deletingPlayerId;
  busy = true;
  requestFailure = '';
  setConnection('Deleting profile…', 'loading');
  renderInterface();
  try {
    await requestJSON('/api/players/' + encodeURIComponent(id), { method: 'DELETE' });
    players = players.filter((player) => player.id !== id);
    if (activePlayerId === id) {
      clearRun();
      activePlayerId = sortProfilesByName(players)[0]?.id || null;
      setMessage(elements.gameMessage, activePlayerId ? 'Press Start run when you are ready.' : 'Create a solo profile to begin.');
    }
    resetEditor();
    elements.profileEditor.open = players.length === 0;
    setMessage(elements.playerMessage, 'Profile deleted.', 'success');
    setConnection('Profiles updated');
    saveRecovery();
  } catch (error) {
    requestFailure = error.message;
    setMessage(elements.playerMessage, error.message + ' The deletion was not confirmed. Reload & recover to check.', 'error');
    setConnection('Delete not confirmed', 'error');
  } finally {
    busy = false;
    deletingPlayerId = null;
    elements.deleteDialog.close();
    renderInterface();
    if (getActivePlayer()) elements.playerSelect.focus();
    else openProfileEditor();
  }
}

// 10. EVENTS: gestures, the optional keyboard blade, forms, and recovery.
elements.playerForm.addEventListener('submit', handlePlayerSubmit);
elements.playerSelect.addEventListener('change', handleProfileChange);
elements.editProfile.addEventListener('click', renameProfile);
elements.deleteProfile.addEventListener('click', requestDeleteProfile);
elements.createProfileShortcut.addEventListener('click', openProfileEditor);
elements.startRun.addEventListener('click', startRun);
elements.pizzaBoard.addEventListener('pointerdown', handlePointerDown);
elements.pizzaBoard.addEventListener('pointermove', handlePointerMove);
elements.pizzaBoard.addEventListener('pointerup', handlePointerUp);
elements.pizzaBoard.addEventListener('pointercancel', cancelPointerStroke);
elements.pizzaBoard.addEventListener('lostpointercapture', () => { if (pointerStroke) cancelPointerStroke(); });
elements.pizzaBoard.addEventListener('keydown', handleBoardKey);
elements.targetPizza.addEventListener('change', () => {
  if (!canAim()) return;
  selectedPizzaId = elements.targetPizza.value;
  renderBlade();
});
elements.bladeAngle.addEventListener('input', renderBlade);
elements.keyboardControls.addEventListener('toggle', renderBlade);
elements.cutAngle.addEventListener('click', submitKeyboardCut);
elements.retryAction.addEventListener('click', () => { if (pendingAction && !busy) void performRunAction(pendingAction); });
elements.checkRun.addEventListener('click', () => {
  if (run && !busy && !pendingAction) void performRunAction({ kind: 'refresh', playerId: run.playerId, runId: run.id, origin: 'manual' });
});
elements.reloadPlayers.addEventListener('click', () => { if (!busy) void initialiseApp(); });
elements.cancelEdit.addEventListener('click', () => {
  resetEditor();
  elements.profileEditor.open = false;
  setMessage(elements.playerMessage, 'Rename cancelled.');
  renderInterface();
  elements.editProfile.focus();
});
elements.profileEditor.addEventListener('toggle', () => {
  if (!elements.profileEditor.open && editingPlayerId && !busy) {
    resetEditor();
    renderInterface();
  }
});
elements.confirmDelete.addEventListener('click', deletePlayer);
elements.cancelDelete.addEventListener('click', () => { if (!busy) elements.deleteDialog.close(); });
elements.deleteDialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
elements.deleteDialog.addEventListener('close', () => { deletingPlayerId = null; });
window.addEventListener('blur', cancelPointerStroke);
reducedMotion.addEventListener('change', () => {
  cancelPointerStroke();
  renderBatchMotion();
  renderBlade();
});
document.addEventListener('visibilitychange', () => {
  cancelPointerStroke();
  if (document.hidden) { tickClock(); return; }
  if (run && !isFinished() && !busy && !pendingAction) {
    void performRunAction({ kind: 'refresh', playerId: run.playerId, runId: run.id, origin: 'visibility' });
  } else tickClock();
});

// 11. STARTUP: load profiles/rules, then replay or refresh the saved run.
async function initialiseApp() {
  if (busy) return;
  stopClock();
  cancelPointerStroke();
  clearFeedback();
  busy = true;
  loaded = false;
  requestFailure = '';
  resetEditor();
  setConnection('Loading your profile…', 'loading');
  renderInterface();
  try {
    const [settings, savedPlayers] = await Promise.all([
      requestJSON('./game-rules.json'), requestJSON('/api/players')
    ]);
    rules = validateRules(settings);
    if (!Array.isArray(savedPlayers) || !savedPlayers.every(isValidPlayer)) throw new Error('Your saved profiles could not be read.');
    players = savedPlayers;
    if (!players.some((player) => player.id === activePlayerId)) {
      clearRun();
      activePlayerId = sortProfilesByName(players)[0]?.id || null;
    }
    loaded = true;
    elements.profileEditor.open = players.length === 0;
    renderRules();
    setConnection('Ready to slice');
    setMessage(elements.playerMessage, '');
    setMessage(elements.gameMessage, players.length ? 'Ready for your one-minute rush? Press Start run.' : 'Create a solo profile, then start your one-minute rush.');
    saveRecovery();
  } catch (error) {
    requestFailure = error.message;
    setConnection('Could not load the arcade', 'error');
    setMessage(elements.playerMessage, error.message + ' Use Reload & recover to try again.', 'error');
  } finally {
    busy = false;
    renderInterface();
  }
  if (!loaded) return;
  if (pendingAction) await performRunAction(pendingAction);
  else if (knownRunId && getActivePlayer()) await performRunAction({ kind: 'refresh', playerId: activePlayerId, runId: knownRunId, origin: 'recovery' });
}

readRecovery();
void initialiseApp();
