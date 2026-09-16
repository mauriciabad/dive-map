import type { MapAttachment } from './controls.ts';

/**
 * What a trackpad means on this map.
 *
 * Two fingers pan, a pinch zooms, a wheel zooms. MapLibre out of the box zooms
 * on all three, because every one of them arrives as a `wheel` event and its
 * scroll handler treats them alike. On a laptop that makes the commonest gesture
 * on the device the one thing the diver did not ask for: a two-finger nudge to
 * shift the view a centimetre throws the camera two zoom levels instead.
 *
 * `cooperativeGestures` is the option that sounds like the answer and is not. It
 * is built for a map embedded in a page you scroll past: it refuses to zoom
 * without ctrl, puts a "use ctrl + scroll to zoom" plate over the map, and hands
 * one-finger touch back to the page. This map is the page, so all three of those
 * are wrong here, and none of them makes two fingers pan.
 *
 * So the wheel is read before MapLibre sees it, on the container in the capture
 * phase, and the two-finger scrolls are taken out and turned into a pan. The
 * rest are let through untouched and zoom exactly as they did.
 *
 * Telling the two apart is a guess, because the browser does not say. These are
 * the tells, in the order they settle it:
 *
 *   ctrl or cmd held   a pinch, which is how every browser reports one, and
 *                      also a real ctrl+wheel. Both mean zoom.
 *   lines or pages     only a mouse wheel reports in anything but pixels.
 *   sideways, or
 *   fractional, or
 *   smaller than a
 *   wheel notch        fingers. A wheel notch is a whole number of pixels,
 *                      never sideways, and never small.
 *
 * A fast flick straight down can pass all three and read as a wheel, so a
 * gesture that has given itself away once keeps its verdict for the rest of the
 * burst. That is what stops a single pan stuttering between panning and zooming.
 */

/** Below this a delta is somebody's fingers rather than a wheel notch. */
const WHEEL_NOTCH = 40;

/** How long a gesture that has given itself away keeps its verdict, in ms. */
const GESTURE_MEMORY = 400;

/**
 * How much zoom a pinch buys, against MapLibre's own 1/100.
 *
 * MapLibre keeps two rates and picks between them by what it decided the event
 * was. A mouse wheel arrives in whole notches of about a hundred pixels and takes
 * the slow rate; a pinch arrives as a stream of small fractional deltas and takes
 * this one. Doubling it halves the finger travel a pinch needs, which is what the
 * owner asked for, and it cannot touch the wheel because the wheel never reads
 * this number.
 *
 * `setZoomRate` is the public name for the pinch one. It is set here rather than
 * in the map's options because this is the file that decides what a trackpad
 * means, and two places deciding that is how they come apart.
 */
const PINCH_ZOOM_RATE = 1 / 50;

export const trackpadGestures: MapAttachment = (map) => {
	const container = map.getContainer();
	map.scrollZoom.setZoomRate(PINCH_ZOOM_RATE);
	let trackpadUntil = 0;
	let alongX = 0;
	let alongY = 0;
	let frame: number | undefined;

	/**
	 * One pan per frame rather than one per event. A trackpad fires faster than
	 * the screen redraws, and each `panBy` is a camera move with its own event
	 * pair behind it.
	 */
	const flush = (): void => {
		frame = undefined;
		const x = alongX;
		const y = alongY;
		alongX = 0;
		alongY = 0;
		if (x === 0 && y === 0) return;
		map.panBy([x, y], { duration: 0 });
	};

	const isTwoFingerScroll = (event: WheelEvent): boolean => {
		if (event.ctrlKey || event.metaKey) return false;
		if (event.deltaMode !== 0) return false;
		const now = performance.now();
		const fingers =
			event.deltaX !== 0 || !Number.isInteger(event.deltaY) || Math.abs(event.deltaY) < WHEEL_NOTCH;
		if (fingers) trackpadUntil = now + GESTURE_MEMORY;
		return fingers || now < trackpadUntil;
	};

	const onWheel = (event: WheelEvent): void => {
		if (!isTwoFingerScroll(event)) return;
		// The capture phase is what puts this ahead of MapLibre, which listens on
		// the canvas container inside this one. Stopping it here is what keeps the
		// scroll handler from zooming on the same event.
		event.preventDefault();
		event.stopPropagation();
		alongX += event.deltaX;
		alongY += event.deltaY;
		frame ??= requestAnimationFrame(flush);
	};

	container.addEventListener('wheel', onWheel, { capture: true, passive: false });
	return () => {
		container.removeEventListener('wheel', onWheel, { capture: true });
		if (frame !== undefined) cancelAnimationFrame(frame);
	};
};
