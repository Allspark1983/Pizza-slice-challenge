import { validateRules, sortPlayersByBestTime, strokeForAngle } from './game.js';

// 1. SELECT: find the page elements once. The SVG itself stays on the page.
const elements = {
  connectionStatus: document.querySelector('#connection-status'),
  playerForm: document.querySelector('#player-form'),
  playerName: document.querySelector('#player-name'),
  playerSubmit: document.querySelector('#player-submit'),
  cancelEdit: document.querySelector('#cancel-edit'),
  playerFormTitle: document.querySelector('#player-form-title'),
  playerList: document.querySelector('#player-list'),
  playersEmpty: document.querySelector('#players-empty'),
  playerCount: document.querySelector('#player-count'),
  playerMessage: document.querySelector('#player-message'),
  leaderboardSize: document.querySelector('#leaderboard-size'),
  leaderboardDescription: document.querySelector('#leaderboard-description'),
  activePlayerName: document.querySelector('#active-player-name'),
  winsDisplay: document.querySelector('#wins-display'),
  lossesDisplay: document.querySelector('#losses-display'),
  best14: document.querySelector('#best-time-14'),
  best10: document.querySelector('#best-time-10'),
  best8: document.querySelector('#best-time-8'),
  sizeRules: document.querySelector('#size-rules'),
  timingSummary: document.querySelector('#timing-summary'),
  pizzaSizeDisplay: document.querySelector('#pizza-size-display'),
  sliceTarget: document.querySelector('#slice-target'),
  cutsDisplay: document.querySelector('#cuts-display'),
  cutsTarget: document.querySelector('#cuts-target'),
  slicesDisplay: document.querySelector('#slices-display'),
  slicesTarget: document.querySelector('#slices-target'),
  roundStatus: document.querySelector('#round-status'),
  roundTimer: document.querySelector('#round-timer'),
  timerLabel: document.querySelector('#timer-label'),
  timerDisplay: document.querySelector('#timer-display'),
  timerProgress: document.querySelector('#timer-progress'),
  countdownAnnouncement: document.querySelector('#countdown-announcement'),
  pizzaBoard: document.querySelector('#pizza-board'),
  pizzaSVG: document.querySelector('#pizza-svg'),
  pizzaSurface: document.querySelector('#pizza-surface'),
  guidesLayer: document.querySelector('#guides-layer'),
  cutsLayer: document.querySelector('#cuts-layer'),
  bladeLayer: document.querySelector('#blade-layer'),
  bladeShadow: document.querySelector('#blade-shadow'),
  bladeLine: document.querySelector('#blade-line'),
  boardOverlay: document.querySelector('#board-overlay'),
  boardOverlayText: document.querySelector('#board-overlay-text'),
  keyboardControls: document.querySelector('#keyboard-controls'),
  bladeAngle: document.querySelector('#blade-angle'),
  bladeAngleValue: document.querySelector('#blade-angle-value'),
  cutAngle: document.querySelector('#cut-angle'),
  startRound: document.querySelector('#start-round'),
  retryAction: document.querySelector('#retry-action'),
  checkRound: document.querySelector('#check-round'),
  reloadPlayers: document.querySelector('#reload-players'),
  gameMessage: document.querySelector('#game-message'),
  deleteDialog: document.querySelector('#delete-dialog'),
  deletePlayerName: document.querySelector('#delete-player-name'),
  confirmDelete: document.querySelector('#confirm-delete'),
  cancelDelete: document.querySelector('#cancel-delete')
};

// 2. DATA: the server owns round results; this page displays its responses.
const recoveryKey = 'four-pizza-slice-challenge.v1';
const svgNamespace = 'http://www.w3.org/2000/svg';
let players = [];
let rules = {
  roundDurationMs: 20000,
  preparationMs: 3000,
  pizzas: [{ sizeInches: 14, slices: 8 }, { sizeInches: 10, slices: 6 }, { sizeInches: 8, slices: 4 }]
};
let activePlayerId = null;
let leaderboardSize = 14;
let editingPlayerId = null;
let deletingPlayerId = null;
let round = null;
let knownRoundId = null;
let pendingAction = null;
let loaded = false;
let busy = false;
let requestFailure = '';
let clockAnchor = null;
let clockInterval = null;
let announcedCountdown = null;
let checkedBoundaries = new Set();
let pointerStroke = null;

function setMessage(element, text, type = '') {
  element.textContent = text;
  element.className = type ? 'message message-' + type : 'message';
}

function setConnection(text, state = 'ready') {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.dataset.state = state;
}

function formatTime(milliseconds) {
  return (milliseconds / 1000).toFixed(3) + ' s';
}

function getActivePlayer() {
  return players.find((player) => player.id === activePlayerId);
}

function isFinished(currentRound = round) {
  return Boolean(currentRound && (currentRound.status === 'won' || currentRound.status === 'lost'));
}

function isRoundLocked() {
  return Boolean(pendingAction || (round && !isFinished()) || (knownRoundId && !round));
}

function validID(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function isValidPlayer(player) {
  return player && validID(player.id) && typeof player.name === 'string' && player.name.trim().length > 0 &&
    Number.isSafeInteger(player.roundsWon) && player.roundsWon >= 0 &&
    Number.isSafeInteger(player.roundsLost) && player.roundsLost >= 0 &&
    player.bestTimesBySize && ['8', '10', '14'].every((size) => {
      const time = player.bestTimesBySize[size];
      return time === null || (Number.isSafeInteger(time) && time >= 1);
    });
}

function isValidRound(value) {
  return value && validID(value.id) && validID(value.playerId) &&
    [8, 10, 14].includes(value.pizzaSize) &&
    ['countdown', 'playing', 'won', 'lost'].includes(value.status) &&
    Number.isInteger(value.requiredCuts) && value.requiredCuts > 0 &&
    value.requiredSlices === value.requiredCuts * 2 &&
    Array.isArray(value.guideAngles) && value.guideAngles.length === value.requiredCuts && value.guideAngles.every(Number.isFinite) &&
    Array.isArray(value.completedCuts) && value.completedCuts.every((index) => Number.isInteger(index) && index >= 0 && index < value.requiredCuts) &&
    Number.isInteger(value.currentSlices) && value.currentSlices >= 1 &&
    [value.startsAt, value.endsAt, value.serverTime, value.remainingMs, value.countdownMs].every(Number.isFinite) &&
    (value.elapsedMs === null || (Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0));
}

// 3. RECOVERY: keep uncertain requests so Retry sends the same request ID.
// sessionStorage is only a convenience; the server still stores every result.
function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 3 && Math.abs(point.y) <= 3;
}

function validStoredAction(action) {
  if (!action || !validID(action.playerId)) return false;
  if (action.kind === 'start') return validID(action.requestId);
  if (action.kind === 'refresh') return validID(action.roundId);
  return action.kind === 'cut' && validID(action.roundId) && validID(action.requestId) && validPoint(action.start) && validPoint(action.end);
}

function readRecovery() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(recoveryKey));
    if (!saved || typeof saved !== 'object') return;
    activePlayerId = validID(saved.playerId) ? saved.playerId : null;
    leaderboardSize = [8, 10, 14].includes(saved.leaderboardSize) ? saved.leaderboardSize : 14;
    knownRoundId = validID(saved.roundId) ? saved.roundId : null;
    pendingAction = validStoredAction(saved.pendingAction) ? saved.pendingAction : null;
  } catch {
    // A browser can block storage. The game still works in the current tab.
  }
}

function saveRecovery() {
  try {
    sessionStorage.setItem(recoveryKey, JSON.stringify({
      playerId: activePlayerId,
      leaderboardSize: leaderboardSize,
      roundId: knownRoundId,
      pendingAction: pendingAction
    }));
  } catch {
    // Storage availability does not change a round's result.
  }
}

function stopClock() {
  if (clockInterval !== null) clearInterval(clockInterval);
  clockInterval = null;
}

function clearRound() {
  stopClock();
  cancelPointerStroke();
  round = null;
  knownRoundId = null;
  pendingAction = null;
  clockAnchor = null;
  announcedCountdown = null;
  checkedBoundaries = new Set();
}

// 4. AJAX: all player changes and all game verdicts come from the REST API.
async function requestJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'The request could not be confirmed.');
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

function roundRequest(action) {
  if (action.kind === 'start') {
    return requestJSON('/api/rounds', {
      method: 'POST', body: { playerId: action.playerId, requestId: action.requestId }
    });
  }
  const url = '/api/rounds/' + encodeURIComponent(action.roundId);
  if (action.kind === 'cut') {
    return requestJSON(url + '/cuts', {
      method: 'POST', body: { requestId: action.requestId, start: action.start, end: action.end }
    });
  }
  return requestJSON(url);
}

function applyEnvelope(envelope) {
  if (!envelope || !isValidRound(envelope.round) || !isValidPlayer(envelope.player) ||
      envelope.round.playerId !== envelope.player.id) {
    throw new Error('The round response could not be read.');
  }
  const previousRound = round;
  if (!previousRound || previousRound.id !== envelope.round.id) {
    checkedBoundaries = new Set();
    announcedCountdown = null;
    elements.bladeAngle.value = '0';
  }
  round = envelope.round;
  knownRoundId = round.id;
  activePlayerId = round.playerId;
  clockAnchor = { serverTime: round.serverTime, receivedAt: performance.now() };
  const exists = players.some((player) => player.id === envelope.player.id);
  players = exists ? players.map((player) => player.id === envelope.player.id ? envelope.player : player) : [...players, envelope.player];
  pendingAction = null;
  requestFailure = '';
  if (isFinished()) {
    stopClock();
    cancelPointerStroke();
    const outcome = round.status === 'won'
      ? 'You win! ' + round.requiredSlices + ' slices from the ' + round.pizzaSize + '-inch pizza in ' + formatTime(round.elapsedMs) + '. Your result is saved.'
      : (round.reason === 'timeout' ? "Time's up! " : 'That complete cut missed a guide. ') + 'This loss is recorded. Have another go or pass the next turn.';
    setMessage(elements.gameMessage, outcome, round.status === 'won' ? 'success' : 'error');
    setMessage(elements.playerMessage, 'Play again or choose another player.');
    setConnection('Result saved');
  } else {
    if (clockInterval === null) clockInterval = setInterval(tickClock, 50);
    const feedback = typeof envelope.feedback === 'string' && envelope.feedback.trim()
      ? envelope.feedback : (round.status === 'countdown' ? 'Study the dashed guides while you get ready.' : 'Follow each dashed guide once.');
    setMessage(elements.gameMessage, feedback);
    setMessage(elements.playerMessage, 'Finish this round before changing players.');
    setConnection(round.status === 'countdown' ? 'Round ready' : 'Round in progress');
    if (previousRound?.status === 'countdown' && round.status === 'playing') {
      elements.countdownAnnouncement.textContent = 'Go! Make your cuts.';
    }
  }
  saveRecovery();
}

async function performRoundAction(action) {
  if (busy || !loaded) return;
  const previousFocus = document.activeElement;
  busy = true;
  requestFailure = '';
  // Copy coordinates now; a later swipe must not alter an uncertain request.
  pendingAction = JSON.parse(JSON.stringify(action));
  saveRecovery();
  setConnection(action.kind === 'cut' ? 'Checking your cut…' : (action.kind === 'start' ? 'Preparing your pizza…' : 'Checking the round…'), 'loading');
  renderInterface();
  try {
    const envelope = await roundRequest(pendingAction);
    applyEnvelope(envelope);
  } catch (error) {
    requestFailure = error.message;
    if (error.status === 404) {
      clearRound();
      setMessage(elements.gameMessage, 'That player or round is no longer available. Reload players to recover.', 'error');
    } else {
      if ([400, 409].includes(error.status)) pendingAction = null;
      setMessage(elements.gameMessage, error.message + ' The action has not been confirmed. Retry, or use Reload & recover.', 'error');
    }
    setConnection('Action not confirmed', 'error');
    saveRecovery();
  } finally {
    busy = false;
    renderInterface();
    if (pendingAction) elements.retryAction.focus();
    else if (isFinished()) elements.startRound.focus();
    else if (action.origin === 'keyboard' && canCut()) elements.cutAngle.focus({ preventScroll: true });
    else if (action.kind === 'start' && round) elements.pizzaBoard.focus();
    else if (previousFocus === elements.bladeAngle && !elements.bladeAngle.disabled) elements.bladeAngle.focus({ preventScroll: true });
    else if (previousFocus === elements.cutAngle && canCut()) elements.cutAngle.focus({ preventScroll: true });
    // A request can cross a phase deadline. Check it after the request settles.
    tickClock();
  }
}

// 5. CLOCK: interpolate a display from server time; never invent a verdict.
function estimatedServerTime() {
  return clockAnchor ? clockAnchor.serverTime + performance.now() - clockAnchor.receivedAt : 0;
}

function phaseRemaining() {
  if (!round) return rules.roundDurationMs;
  if (isFinished()) return Math.max(0, round.remainingMs);
  const deadline = round.status === 'countdown' ? round.startsAt : round.endsAt;
  return Math.max(0, deadline - estimatedServerTime());
}

function boundaryKey() {
  if (!round || isFinished() || phaseRemaining() > 0) return null;
  return round.id + ':' + round.status;
}

function canCut() {
  return Boolean(loaded && !busy && !pendingAction && round?.status === 'playing' && phaseRemaining() > 0);
}

function renderClock() {
  const remaining = phaseRemaining();
  const countdown = round?.status === 'countdown';
  const won = round?.status === 'won';
  elements.timerLabel.textContent = countdown ? 'Get ready' : (won ? 'Finish time' : 'Time to slice');
  elements.timerDisplay.textContent = won ? (round.elapsedMs / 1000).toFixed(3)
    : (countdown ? String(Math.ceil(remaining / 1000)) : (Math.ceil(remaining / 100) / 10).toFixed(1));
  elements.timerProgress.max = countdown
    ? Math.max(1, round.countdownMs)
    : Math.max(1, round ? round.endsAt - round.startsAt : rules.roundDurationMs);
  elements.timerProgress.value = remaining;
  elements.timerProgress.setAttribute('aria-valuetext', (Math.ceil(remaining / 100) / 10).toFixed(1) + ' seconds remaining');
  elements.roundTimer.dataset.state = round?.status || 'ready';
  elements.roundTimer.dataset.urgent = String(round?.status === 'playing' && remaining <= 5000);
  elements.roundStatus.dataset.state = round?.status || 'ready';

  let overlay = '';
  if (!loaded) overlay = 'Loading your pizza table…';
  else if (!round) overlay = busy ? 'Preparing your pizza…' : 'Choose a player, then start a round.';
  else if (isFinished()) overlay = won ? 'Perfect slices. Well played!' : (round.reason === 'timeout' ? "Time's up" : 'Wrong cut — try again');
  else if (pendingAction && requestFailure) overlay = 'Waiting for confirmation';
  else if (countdown && remaining > 0) overlay = 'Ready in ' + Math.ceil(remaining / 1000);
  else if (boundaryKey()) overlay = round.status === 'countdown' ? 'Starting the round…' : 'Checking result…';
  else if (busy) overlay = 'Checking your cut…';
  elements.boardOverlay.hidden = !overlay;
  elements.boardOverlayText.textContent = overlay;
  elements.roundStatus.textContent = !loaded ? 'Getting ready' : (!round ? 'Ready when you are' :
    (won ? 'You win!' : (round.status === 'lost' ? 'Round lost' :
      (boundaryKey() ? 'Checking result' : (countdown ? 'Get ready' : 'Round in progress')))));

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
  elements.bladeAngle.disabled = !loaded || busy || Boolean(pendingAction) || !round || isFinished();
  elements.checkRound.hidden = !round || isFinished() || Boolean(pendingAction) ||
    (!requestFailure && !(boundaryKey() && checkedBoundaries.has(boundaryKey())));
  elements.checkRound.disabled = busy;
}

function tickClock() {
  renderClock();
  const key = boundaryKey();
  if (!key || busy || pendingAction || checkedBoundaries.has(key)) return;
  // At most one automatic GET per phase. Failures have an explicit Retry.
  checkedBoundaries.add(key);
  void performRoundAction({ kind: 'refresh', playerId: round.playerId, roundId: round.id, origin: 'phase' });
}

// 6. RENDER: display player data, guides, and server-confirmed cuts.
function makePlayerButton(label, className, action, playerId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.playerId = playerId;
  button.disabled = busy || !loaded || isRoundLocked();
  return button;
}

function renderPlayers(playerList) {
  elements.playerList.innerHTML = '';
  elements.playerCount.textContent = playerList.length;
  elements.playersEmpty.hidden = playerList.length > 0;
  elements.playersEmpty.textContent = loaded ? 'No players yet. Add a name above to begin.' : (busy ? 'Loading your players…' : 'Reload players to try again.');
  elements.leaderboardSize.value = String(leaderboardSize);
  elements.leaderboardSize.disabled = !loaded || busy;
  elements.leaderboardDescription.textContent = 'Fastest ' + leaderboardSize + '-inch finish first. Choose a player below.';
  playerList.forEach((player, index) => {
    const time = player.bestTimesBySize[String(leaderboardSize)];
    const ranked = time !== null;
    const row = document.createElement('li');
    row.className = 'player-row' + (player.id === activePlayerId ? ' is-selected' : '');
    const choose = makePlayerButton('', 'player-choice', 'select', player.id);
    choose.setAttribute('aria-pressed', String(player.id === activePlayerId));
    choose.setAttribute('aria-label', (ranked ? 'Rank ' + (index + 1) + '. ' : 'Unranked. ') + 'Play as ' + player.name + '. ' +
      player.roundsWon + ' wins, ' + player.roundsLost + ' losses. ' + (ranked ? 'Best ' + leaderboardSize + '-inch time ' + formatTime(time) : 'No ' + leaderboardSize + '-inch finish yet.'));
    const rank = document.createElement('span');
    rank.className = 'player-rank';
    rank.textContent = ranked ? '#' + (index + 1) : '—';
    rank.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'player-copy';
    const title = document.createElement('span');
    title.className = 'player-title';
    title.textContent = player.name;
    const best = document.createElement('span');
    best.className = 'player-best';
    best.textContent = ranked ? formatTime(time) : 'No finish for this size yet';
    const meta = document.createElement('span');
    meta.className = 'player-meta';
    meta.textContent = player.roundsWon + ' wins · ' + player.roundsLost + ' losses' + (player.id === activePlayerId ? ' · Selected' : '');
    copy.append(title, best, meta);
    choose.append(rank, copy);
    const actions = document.createElement('div');
    actions.className = 'player-actions';
    const edit = makePlayerButton('Edit', 'player-edit', 'edit', player.id);
    edit.setAttribute('aria-label', 'Edit ' + player.name);
    const remove = makePlayerButton('Delete', 'player-delete', 'delete', player.id);
    remove.setAttribute('aria-label', 'Delete ' + player.name);
    actions.append(edit, remove);
    row.append(choose, actions);
    elements.playerList.appendChild(row);
  });
  const locked = busy || !loaded || isRoundLocked();
  elements.playerName.disabled = locked;
  elements.playerSubmit.disabled = locked;
  elements.cancelEdit.disabled = locked;
  elements.cancelEdit.hidden = !editingPlayerId;
  elements.playerSubmit.textContent = editingPlayerId ? 'Save changes' : 'Add player';
  elements.playerFormTitle.textContent = editingPlayerId ? 'Edit player' : 'Add a player';
}

function makeSVGLine(stroke, className) {
  const line = document.createElementNS(svgNamespace, 'line');
  line.setAttribute('class', className);
  setLinePoints(line, stroke);
  return line;
}

function setLinePoints(line, stroke) {
  line.setAttribute('x1', stroke.start.x * 100);
  line.setAttribute('y1', stroke.start.y * 100);
  line.setAttribute('x2', stroke.end.x * 100);
  line.setAttribute('y2', stroke.end.y * 100);
}

function renderPizza() {
  const size = round?.pizzaSize || 14;
  elements.pizzaSurface.setAttribute('transform', 'scale(' + size / 14 + ')');
  elements.pizzaBoard.dataset.state = round?.status || 'ready';
  elements.pizzaBoard.setAttribute('aria-label', round ? size + '-inch pizza. ' + round.completedCuts.length + ' of ' + round.requiredCuts + ' cuts completed.' : 'Whole pizza slicing board');
  elements.guidesLayer.replaceChildren();
  elements.cutsLayer.replaceChildren();
  if (round) {
    round.guideAngles.forEach((angle, index) => {
      const cut = round.completedCuts.includes(index);
      const stroke = strokeForAngle(angle, 1);
      const layer = cut ? elements.cutsLayer : elements.guidesLayer;
      layer.appendChild(makeSVGLine(stroke, cut ? 'pizza-cut-shadow' : 'pizza-guide-shadow'));
      layer.appendChild(makeSVGLine(stroke, cut ? 'pizza-cut' : 'pizza-guide'));
    });
  }
  renderBlade();
}

function renderBlade() {
  const showAngle = elements.keyboardControls.open && round && !isFinished();
  const stroke = pointerStroke || (showAngle ? strokeForAngle(Number(elements.bladeAngle.value), 1.08) : null);
  elements.bladeLayer.style.display = stroke ? '' : 'none';
  if (stroke) {
    setLinePoints(elements.bladeShadow, stroke);
    setLinePoints(elements.bladeLine, stroke);
  }
  elements.bladeAngleValue.textContent = elements.bladeAngle.value + '°';
}

function renderInterface() {
  // A returned array is passed straight into the function that displays it.
  renderPlayers(sortPlayersByBestTime(players, leaderboardSize));
  const player = getActivePlayer();
  elements.activePlayerName.textContent = player?.name || 'Choose a player';
  elements.winsDisplay.textContent = player?.roundsWon || 0;
  elements.lossesDisplay.textContent = player?.roundsLost || 0;
  [[14, elements.best14], [10, elements.best10], [8, elements.best8]].forEach(([size, element]) => {
    const time = player ? player.bestTimesBySize[String(size)] : null;
    element.textContent = time === null ? 'No finish yet' : formatTime(time);
    element.classList.toggle('no-best', time === null);
    element.parentElement.classList.toggle('is-active', round?.pizzaSize === size);
  });
  elements.pizzaSizeDisplay.textContent = round ? round.pizzaSize + ' inch' : '—';
  elements.sliceTarget.textContent = round ? round.requiredSlices + ' slices · ' + round.requiredCuts + ' full cuts' : 'Start a round to reveal it';
  elements.cutsDisplay.textContent = round ? round.completedCuts.length : 0;
  elements.cutsTarget.textContent = round ? round.requiredCuts : '—';
  elements.slicesDisplay.textContent = round ? round.currentSlices : 1;
  elements.slicesTarget.textContent = round ? round.requiredSlices : '—';
  elements.startRound.disabled = !loaded || busy || !player || isRoundLocked() || Boolean(editingPlayerId);
  elements.startRound.textContent = isFinished() ? 'Play again' : 'Start round';
  elements.retryAction.hidden = !pendingAction;
  elements.retryAction.disabled = busy;
  elements.retryAction.textContent = pendingAction?.kind === 'cut' ? 'Retry cut' : (pendingAction?.kind === 'start' ? 'Retry start' : 'Retry check');
  elements.reloadPlayers.hidden = !requestFailure && loaded;
  elements.reloadPlayers.disabled = busy;
  elements.confirmDelete.disabled = busy;
  elements.cancelDelete.disabled = busy;
  renderPizza();
  renderClock();
}

function renderRules() {
  elements.sizeRules.replaceChildren();
  rules.pizzas.forEach((pizza) => {
    const row = document.createElement('li');
    const size = document.createElement('strong');
    size.textContent = pizza.sizeInches + '″';
    const details = document.createElement('span');
    details.textContent = pizza.slices + ' slices · ' + pizza.slices / 2 + ' cuts';
    row.append(size, details);
    elements.sizeRules.appendChild(row);
  });
  elements.timingSummary.textContent = rules.preparationMs / 1000 + ' seconds to prepare, then ' + rules.roundDurationMs / 1000 + ' seconds to slice.';
}

// 7. INPUT: convert responsive SVG coordinates into a radius-one pizza.
function pointerPoint(event) {
  const transform = elements.pizzaSVG.getScreenCTM();
  if (!transform) return null;
  const point = elements.pizzaSVG.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(transform.inverse());
  const pizzaRadius = 100 * (round.pizzaSize / 14);
  const normalise = (coordinate) => Math.round(Math.max(-3, Math.min(3, coordinate / pizzaRadius)) * 1000000) / 1000000;
  return { x: normalise(local.x), y: normalise(local.y) };
}

function cancelPointerStroke() {
  const pointerId = pointerStroke?.pointerId;
  pointerStroke = null;
  if (pointerId !== undefined && elements.pizzaBoard.hasPointerCapture(pointerId)) {
    elements.pizzaBoard.releasePointerCapture(pointerId);
  }
  renderBlade();
}

function handlePointerDown(event) {
  if (!canCut() || !event.isPrimary || event.button !== 0) return;
  const point = pointerPoint(event);
  if (!point) return;
  event.preventDefault();
  elements.pizzaBoard.focus({ preventScroll: true });
  pointerStroke = { pointerId: event.pointerId, start: point, end: point };
  elements.pizzaBoard.setPointerCapture(event.pointerId);
  renderBlade();
}

function handlePointerMove(event) {
  if (!pointerStroke || event.pointerId !== pointerStroke.pointerId) return;
  if (!canCut()) { cancelPointerStroke(); tickClock(); return; }
  const point = pointerPoint(event);
  if (!point) return;
  event.preventDefault();
  pointerStroke.end = point;
  renderBlade();
}

function handlePointerUp(event) {
  if (!pointerStroke || event.pointerId !== pointerStroke.pointerId) return;
  const start = pointerStroke.start;
  const end = pointerPoint(event);
  cancelPointerStroke();
  if (!end || !canCut()) { tickClock(); return; }
  void submitCut({ start: start, end: end }, 'pointer');
}

function submitCut(stroke, origin) {
  if (!canCut()) { tickClock(); return; }
  return performRoundAction({
    kind: 'cut', playerId: round.playerId, roundId: round.id,
    requestId: crypto.randomUUID(), start: stroke.start, end: stroke.end, origin: origin
  });
}

function submitKeyboardCut() {
  if (!canCut()) { tickClock(); return; }
  // The chosen angle is the player's aim, not an automatically selected guide.
  void submitCut(strokeForAngle(Number(elements.bladeAngle.value), 1.08), 'keyboard');
}

function startRound() {
  if (!loaded || busy || !getActivePlayer() || isRoundLocked() || editingPlayerId) return;
  void performRoundAction({ kind: 'start', playerId: activePlayerId, requestId: crypto.randomUUID(), origin: 'start' });
}

// 8. PLAYER CRUD: names can change; scores can only change through rounds.
function resetEditor() {
  editingPlayerId = null;
  elements.playerForm.reset();
  elements.playerName.removeAttribute('aria-invalid');
}

async function handlePlayerSubmit(event) {
  event.preventDefault();
  if (busy || !loaded || isRoundLocked()) return;
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
  setConnection('Saving player…', 'loading');
  renderInterface();
  try {
    const player = await requestJSON(wasEditing ? '/api/players/' + encodeURIComponent(editingPlayerId) : '/api/players', {
      method: wasEditing ? 'PATCH' : 'POST', body: { name: name }
    });
    if (!isValidPlayer(player)) throw new Error('The player response could not be read.');
    if (wasEditing) players = players.map((item) => item.id === player.id ? player : item);
    else { players.push(player); activePlayerId = player.id; clearRound(); }
    resetEditor();
    setMessage(elements.playerMessage, wasEditing ? 'Player name updated.' : player.name + ' is ready to play.', 'success');
    if (!wasEditing) setMessage(elements.gameMessage, 'Press Start round to reveal a pizza and begin the preparation countdown.');
    setConnection('Player saved');
    saveRecovery();
  } catch (error) {
    requestFailure = error.message;
    setMessage(elements.playerMessage, error.message + ' The change was not confirmed. Reload players to check.', 'error');
    setConnection('Change not confirmed', 'error');
  } finally {
    busy = false;
    renderInterface();
    elements.playerName.focus();
  }
}

function handlePlayerAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !elements.playerList.contains(button) || busy || isRoundLocked()) return;
  const player = players.find((item) => item.id === button.dataset.playerId);
  if (!player) return;
  if (button.dataset.action === 'select') {
    clearRound();
    activePlayerId = player.id;
    requestFailure = '';
    resetEditor();
    setMessage(elements.playerMessage, player.name + ' selected.');
    setMessage(elements.gameMessage, 'Press Start round when you are ready. An unfinished round will resume.');
    saveRecovery();
    renderInterface();
    elements.startRound.focus();
  } else if (button.dataset.action === 'edit') {
    editingPlayerId = player.id;
    elements.playerName.value = player.name;
    setMessage(elements.playerMessage, 'Change the name, then save your changes.');
    renderInterface();
    elements.playerName.focus();
    elements.playerName.select();
  } else if (button.dataset.action === 'delete') {
    deletingPlayerId = player.id;
    elements.deletePlayerName.textContent = player.name;
    elements.deleteDialog.showModal();
    elements.cancelDelete.focus();
  }
}

async function deletePlayer() {
  if (!deletingPlayerId || busy) return;
  const id = deletingPlayerId;
  busy = true;
  requestFailure = '';
  setConnection('Deleting player…', 'loading');
  renderInterface();
  try {
    await requestJSON('/api/players/' + encodeURIComponent(id), { method: 'DELETE' });
    players = players.filter((player) => player.id !== id);
    if (activePlayerId === id) {
      clearRound();
      activePlayerId = players[0]?.id || null;
      setMessage(elements.gameMessage, activePlayerId ? 'Press Start round to play.' : 'Add a player to begin.');
    }
    if (editingPlayerId === id) resetEditor();
    setMessage(elements.playerMessage, 'Player deleted.', 'success');
    setConnection('Players updated');
    saveRecovery();
  } catch (error) {
    requestFailure = error.message;
    setMessage(elements.playerMessage, error.message + ' The deletion was not confirmed. Reload players to check.', 'error');
    setConnection('Delete not confirmed', 'error');
  } finally {
    busy = false;
    deletingPlayerId = null;
    elements.deleteDialog.close();
    renderInterface();
    elements.playerName.focus();
  }
}

// 9. EVENTS: pointer input, keyboard input, forms, and recovery controls.
elements.playerForm.addEventListener('submit', handlePlayerSubmit);
elements.playerList.addEventListener('click', handlePlayerAction);
elements.startRound.addEventListener('click', startRound);
elements.pizzaBoard.addEventListener('pointerdown', handlePointerDown);
elements.pizzaBoard.addEventListener('pointermove', handlePointerMove);
elements.pizzaBoard.addEventListener('pointerup', handlePointerUp);
elements.pizzaBoard.addEventListener('pointercancel', cancelPointerStroke);
elements.pizzaBoard.addEventListener('lostpointercapture', () => { if (pointerStroke) cancelPointerStroke(); });
elements.pizzaBoard.addEventListener('keydown', (event) => {
  if (!round || isFinished() || busy || pendingAction) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    elements.keyboardControls.open = true;
    elements.bladeAngle.value = String((Number(elements.bladeAngle.value) + (event.key === 'ArrowRight' ? 5 : 175)) % 180);
    renderBlade();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    submitKeyboardCut();
  }
});
elements.bladeAngle.addEventListener('input', renderBlade);
elements.keyboardControls.addEventListener('toggle', renderBlade);
elements.cutAngle.addEventListener('click', submitKeyboardCut);
elements.leaderboardSize.addEventListener('change', () => {
  leaderboardSize = Number(elements.leaderboardSize.value);
  renderPlayers(sortPlayersByBestTime(players, leaderboardSize));
  saveRecovery();
});
elements.retryAction.addEventListener('click', () => { if (pendingAction && !busy) void performRoundAction(pendingAction); });
elements.checkRound.addEventListener('click', () => {
  if (round && !busy) void performRoundAction({ kind: 'refresh', playerId: round.playerId, roundId: round.id, origin: 'manual' });
});
elements.reloadPlayers.addEventListener('click', () => { if (!busy) void initialiseApp(); });
elements.cancelEdit.addEventListener('click', () => {
  resetEditor();
  setMessage(elements.playerMessage, 'Edit cancelled.');
  renderInterface();
  elements.playerName.focus();
});
elements.confirmDelete.addEventListener('click', deletePlayer);
elements.cancelDelete.addEventListener('click', () => { if (!busy) elements.deleteDialog.close(); });
elements.deleteDialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
elements.deleteDialog.addEventListener('close', () => { deletingPlayerId = null; });
document.addEventListener('visibilitychange', () => {
  cancelPointerStroke();
  if (document.hidden) { tickClock(); return; }
  if (round && !isFinished() && !busy && !pendingAction) {
    void performRoundAction({ kind: 'refresh', playerId: round.playerId, roundId: round.id, origin: 'visibility' });
  } else tickClock();
});

// 10. STARTUP: GET settings and players, then recover a known round if needed.
async function initialiseApp() {
  if (busy) return;
  stopClock();
  cancelPointerStroke();
  busy = true;
  loaded = false;
  requestFailure = '';
  resetEditor();
  setConnection('Loading players…', 'loading');
  renderInterface();
  try {
    const [settings, savedPlayers] = await Promise.all([
      requestJSON('./game-rules.json'), requestJSON('/api/players')
    ]);
    rules = validateRules(settings);
    if (!Array.isArray(savedPlayers) || !savedPlayers.every(isValidPlayer)) throw new Error('The saved players could not be read.');
    players = savedPlayers;
    if (!players.some((player) => player.id === activePlayerId)) {
      clearRound();
      activePlayerId = players[0]?.id || null;
    }
    loaded = true;
    renderRules();
    setConnection('Players loaded');
    setMessage(elements.playerMessage, '');
    setMessage(elements.gameMessage, players.length ? 'Choose your player, then start a round.' : 'Add a player to begin.');
    saveRecovery();
  } catch (error) {
    requestFailure = error.message;
    setConnection('Could not load players', 'error');
    setMessage(elements.playerMessage, error.message + ' Use Reload & recover to try again.', 'error');
  } finally {
    busy = false;
    renderInterface();
  }
  if (!loaded) return;
  if (pendingAction) await performRoundAction(pendingAction);
  else if (knownRoundId && getActivePlayer()) await performRoundAction({ kind: 'refresh', playerId: activePlayerId, roundId: knownRoundId, origin: 'recovery' });
}

readRecovery();
void initialiseApp();
