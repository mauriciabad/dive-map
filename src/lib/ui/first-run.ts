import type { LngLat } from '$lib/domain/card';

/**
 * Where the opening hints sit and how the line from each one reaches what it is
 * pointing at.
 *
 * Two things move under this. The coast is a place on the map, so its point on
 * screen changes every time the diver drags, and dragging is the one gesture
 * that must not put the hints away. The locate button is in a corner MapLibre
 * lays out, so its point changes with a notch, a rotation and whether the
 * compass is showing. Both are measured rather than assumed, and everything
 * below works in viewport pixels because that is the one unit both arrive in.
 */

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface Box {
	readonly width: number;
	readonly height: number;
}

export interface Placement {
	/** Top-left of the plaque. */
	readonly at: Point;
	/** The leader, from the plaque's edge to just short of the target. */
	readonly leader: string;
	/** The arrowhead, already turned to meet the leader. */
	readonly head: string;
	/** Unit vector the arrow is travelling in, for the nudge that says "there". */
	readonly heading: Point;
}

/**
 * Where the coast arrow lands: the shore off Tossa de Mar, halfway along.
 *
 * The middle of the survey outline is open sea, which is the one thing there is
 * no point zooming into, so the arrow goes to the shoreline itself. Halfway
 * rather than at the Medes end, because the far north-east of the coast sits
 * directly under the corner the locate button is in and two hints crowding one
 * corner is worse than a hint that names a slightly less famous reef.
 */
export const COAST_HINT: LngLat = { lng: 2.93, lat: 41.715 };

/** Nothing gets closer than this to an edge. A hint half off a phone is worse than none. */
const MARGIN = 12;

/** How far short of the target the arrow stops, so the tip points at it rather than covers it. */
const TIP_GAP = 15;

const HEAD_LENGTH = 13;
const HEAD_SPREAD = 0.44;

/** Below this the plaque and the target are on top of each other and a leader says nothing. */
const TOO_CLOSE = 26;

const clamp = (value: number, low: number, high: number): number =>
	Math.min(Math.max(value, low), Math.max(low, high));

const round = (value: number): number => Math.round(value * 10) / 10;

/** The point on a box's outline, from its centre, in the direction of somewhere else. */
const edgeToward = (centre: Point, box: Box, towards: Point): Point => {
	const dx = towards.x - centre.x;
	const dy = towards.y - centre.y;
	if (dx === 0 && dy === 0) return centre;
	const along = Math.min(
		dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
		dy === 0 ? Infinity : box.height / 2 / Math.abs(dy)
	);
	return { x: centre.x + dx * along, y: centre.y + dy * along };
};

const shortOf = (target: Point, from: Point, gap: number): Point => {
	const dx = target.x - from.x;
	const dy = target.y - from.y;
	const span = Math.hypot(dx, dy);
	if (span === 0) return target;
	return { x: target.x - (dx / span) * gap, y: target.y - (dy / span) * gap };
};

/**
 * A leader is a quadratic curve rather than a straight line, and the curve is the
 * point. A ruled line reads as part of the map, which is full of ruled lines; a
 * bowed one reads as something somebody drew on top of it.
 */
const draw = (from: Point, to: Point, bow: number): Omit<Placement, 'at'> => {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const span = Math.hypot(dx, dy);
	if (span < TOO_CLOSE) return { leader: '', head: '', heading: { x: 0, y: 0 } };
	const control = {
		x: (from.x + to.x) / 2 - (dy / span) * bow,
		y: (from.y + to.y) / 2 + (dx / span) * bow
	};
	const tipX = to.x - control.x;
	const tipY = to.y - control.y;
	const tip = Math.hypot(tipX, tipY);
	const heading = tip === 0 ? { x: 0, y: 0 } : { x: tipX / tip, y: tipY / tip };
	const angle = Math.atan2(heading.y, heading.x);
	const barb = (turn: number): string =>
		`${round(to.x - Math.cos(angle + turn) * HEAD_LENGTH)} ${round(to.y - Math.sin(angle + turn) * HEAD_LENGTH)}`;
	return {
		leader: `M ${round(from.x)} ${round(from.y)} Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`,
		head: `M ${barb(HEAD_SPREAD)} L ${round(to.x)} ${round(to.y)} L ${barb(-HEAD_SPREAD)}`,
		heading
	};
};

/**
 * Lay one hint out.
 *
 * `offset` is where the plaque's centre would like to sit relative to the target,
 * and it is a wish rather than an instruction: a plaque that would hang off the
 * screen is pulled back inside and the leader is redrawn from wherever it ended
 * up. That is what keeps the same two hints working on a laptop and on a phone
 * held sideways without a breakpoint deciding anything.
 */
export const placeHint = (
	target: Point,
	plaque: Box,
	viewport: Box,
	offset: Point,
	bow: number
): Placement => {
	const at = {
		x: clamp(
			target.x + offset.x - plaque.width / 2,
			MARGIN,
			viewport.width - plaque.width - MARGIN
		),
		y: clamp(
			target.y + offset.y - plaque.height / 2,
			MARGIN,
			viewport.height - plaque.height - MARGIN
		)
	};
	const centre = { x: at.x + plaque.width / 2, y: at.y + plaque.height / 2 };
	const from = edgeToward(centre, plaque, target);
	return { at, ...draw(from, shortOf(target, from, TIP_GAP), bow) };
};

/**
 * Keep a point the arrow has to reach on screen. Panning never puts the hints
 * away, so the coast can be dragged towards an edge, and an arrow pointing off
 * the screen in roughly the right direction still says "over there" where one
 * pointing at nothing says nothing.
 */
export const onScreen = (target: Point, viewport: Box, inset: number): Point => ({
	x: clamp(target.x, inset, viewport.width - inset),
	y: clamp(target.y, inset, viewport.height - inset)
});
