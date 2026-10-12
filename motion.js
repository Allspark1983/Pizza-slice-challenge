// Version 3.2 presentation helpers. The scoring API keeps its fixed board coordinates.
export const BATCH_ENTRY_MS = 450;
export const BATCH_ENTRY_DISTANCE = 300;

// Use elapsed server time so a new response never restarts the same batch's entrance.
export function entranceOffset(elapsedMs, reducedMotion = false) {
  if (!Number.isFinite(elapsedMs)) throw new Error('The entrance needs a finite elapsed time.');
  if (reducedMotion || elapsedMs >= BATCH_ENTRY_MS) return 0;
  if (elapsedMs <= 0) return -BATCH_ENTRY_DISTANCE;
  const remaining = 1 - elapsedMs / BATCH_ENTRY_MS;
  return -BATCH_ENTRY_DISTANCE * remaining * remaining * remaining;
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

// Clip a straight stroke as a segment, preserving its direction and angle.
// Clamping x/y endpoints separately could turn a harmless diagonal into a wrong cut.
export function clipStrokeToBounds(stroke, limit = 200) {
  if (!stroke || !validPoint(stroke.start) || !validPoint(stroke.end) ||
      !Number.isFinite(limit) || limit <= 0) throw new Error('Use finite stroke coordinates and a positive board limit.');
  const { start, end } = stroke;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('The stroke is too large to map to the board.');
  let first = 0;
  let last = 1;
  for (const [direction, distance] of [
    [-dx, start.x + limit], [dx, limit - start.x],
    [-dy, start.y + limit], [dy, limit - start.y]
  ]) {
    if (direction === 0) {
      if (distance < 0) return null;
      continue;
    }
    const fraction = distance / direction;
    if (direction < 0) first = Math.max(first, fraction);
    else last = Math.min(last, fraction);
    if (first > last) return null;
  }
  // Limit only floating-point boundary noise after the geometric clipping above.
  const bound = (value) => Math.max(-limit, Math.min(limit, value));
  const pointAt = (fraction) => ({ x: bound(start.x + dx * fraction), y: bound(start.y + dy * fraction) });
  return { start: pointAt(first), end: pointAt(last) };
}
