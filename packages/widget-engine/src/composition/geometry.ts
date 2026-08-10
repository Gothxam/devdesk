/**
 * Rectangles, in logical pixels.
 *
 * ## Why the composition layer has its own
 *
 * `devdesk-display` owns the authoritative coordinate spaces (`WD-1`), and they
 * are Rust types. What crosses IPC is numbers. Rather than pretend the shell
 * holds a `PhysicalRect`, this declares the one shape composition needs and says
 * plainly which space it is in.
 *
 * **Logical pixels throughout.** Composition is about what the user sees at the
 * size they see it: a surface 240 units wide is 240 CSS pixels on a 100% display
 * and 240 CSS pixels on a 150% one, because the browser scales. Physical pixels
 * are the display subsystem's business and the window subsystem's; nothing here
 * needs them, and carrying them would mean converting at every hit test.
 *
 * ## No layout
 *
 * Nothing here computes a position. Rectangles arrive from the caller — today
 * from the shell, later from the layout actor — and composition arranges,
 * clips, and tests against what it is given. A composition layer that could
 * decide where a surface goes would be a second layout engine, and the two would
 * disagree.
 */

/** A point in logical pixels, relative to the virtual desktop origin. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in logical pixels, relative to the virtual desktop origin. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The empty rectangle. Distinct from "no rectangle", which is `undefined`. */
export const EMPTY_RECT: Rect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/** Builds a frozen rectangle, clamping negative extents to zero. */
export function rect(x: number, y: number, width: number, height: number): Rect {
  return Object.freeze({
    x,
    y,
    // A negative extent is a caller's arithmetic error. Clamping rather than
    // rejecting keeps every downstream operation total: an empty rectangle
    // intersects nothing and contains nothing, which is the right answer.
    width: Math.max(0, width),
    height: Math.max(0, height),
  });
}

/** Whether a rectangle has no area. */
export function isEmpty(value: Rect): boolean {
  return value.width <= 0 || value.height <= 0;
}

/**
 * Whether a point lies inside a rectangle.
 *
 * Upper bounds are exclusive, so two rectangles sharing an edge do not both
 * contain the point on it. Inclusive bounds put a click on a shared edge in two
 * surfaces at once, and which one wins then depends on iteration order.
 */
export function contains(value: Rect, point: Point): boolean {
  return (
    point.x >= value.x &&
    point.y >= value.y &&
    point.x < value.x + value.width &&
    point.y < value.y + value.height
  );
}

/** Whether two rectangles share any area. Touching edges do not count. */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/** The overlapping area of two rectangles, empty when they do not overlap. */
export function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  return rect(x, y, right - x, bottom - y);
}

/**
 * The smallest rectangle containing both.
 *
 * An empty operand is ignored rather than included: a zero-area rectangle at the
 * origin would drag every union back to the origin, which is how a damage region
 * silently becomes the whole desktop.
 */
export function union(a: Rect, b: Rect): Rect {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;

  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);

  return rect(x, y, right - x, bottom - y);
}

/** The smallest rectangle containing all of them. */
export function bounds(rects: Iterable<Rect>): Rect {
  let total = EMPTY_RECT;
  for (const value of rects) total = union(total, value);
  return total;
}

/** Whether `outer` fully contains `inner`. An empty inner is contained. */
export function encloses(outer: Rect, inner: Rect): boolean {
  if (isEmpty(inner)) return true;
  if (isEmpty(outer)) return false;

  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Whether two rectangles describe the same area. */
export function equalRects(a: Rect, b: Rect): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The area, for deciding whether a damage region is worth the bookkeeping. */
export function area(value: Rect): number {
  return isEmpty(value) ? 0 : value.width * value.height;
}
