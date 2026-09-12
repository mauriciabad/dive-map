import { type Course, estimateCourse } from './course.ts';
import { type Fix, toFix } from './fix.ts';
import { type AvatarId, DEFAULT_AVATAR } from './avatars.ts';
import {
	DEFAULT_WINDOW,
	type TrailPoint,
	type TrailWindow,
	appendFix,
	trimTrail
} from './trail.ts';
import { type WatchState, OFF, type WatchEvent, lastFix, reduceWatch } from './watch-state.ts';

/**
 * The live position, the trail behind it and the course it is making. One object
 * because all three are recomputed from the same event, a fix arriving, and
 * splitting them would mean three things to keep in step.
 */

const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

/** Older than this and the avatar dims. Under way that is about 50 m of uncertainty. */
export const STALE_AFTER_MS = 12_000;

/**
 * Some browsers stop calling back after a denial or a long background, without
 * ever running the error callback, so the state would sit on `tracking` with a
 * fix from ten minutes ago and look perfectly healthy. A silent watch gets torn
 * down and rebuilt rather than trusted.
 */
const WATCHDOG_MS = 45_000;
const TICK_MS = 1000;

export type Support = 'ok' | 'no-api' | 'insecure';

const detectSupport = (): Support => {
	if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'no-api';
	if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
	return 'ok';
};

export class PositionTracker {
	readonly support: Support = detectSupport();

	watch = $state.raw<WatchState>(OFF);
	trail = $state.raw<readonly TrailPoint[]>([]);
	course = $state.raw<Course>({ kind: 'unknown' });
	window = $state.raw<TrailWindow>(DEFAULT_WINDOW);
	avatar = $state<AvatarId>(DEFAULT_AVATAR);
	showTrail = $state(true);
	showTrajectory = $state(true);
	panelOpen = $state(false);

	/** Drives trimming and the gradient's ageing while no fixes are arriving. */
	now = $state(Date.now());

	/** Bumped whenever the map should jump to the boat. The map attachment consumes it. */
	recentreSeq = $state(0);

	#watchId: number | undefined;
	#timer: ReturnType<typeof setInterval> | undefined;
	#lastCallbackAt = 0;
	#lastFixAt = 0;

	get fix(): Fix | undefined {
		return lastFix(this.watch);
	}

	get tracking(): boolean {
		return this.watch.status === 'tracking' && !this.stale;
	}

	get stale(): boolean {
		const fix = this.fix;
		return fix === undefined || this.now - fix.at > STALE_AFTER_MS;
	}

	get enabled(): boolean {
		return this.watch.status !== 'off' && this.watch.status !== 'unsupported';
	}

	toggle(): void {
		if (this.enabled) this.stop();
		else this.start();
	}

	start(): void {
		if (this.support !== 'ok') {
			this.watch = reduceWatch(this.watch, { type: 'unsupported' });
			return;
		}
		// Re-pressing the button while already tracking means "take me back to the
		// boat", not "start again". Restarting would throw away the trail.
		if (this.enabled) {
			this.recentreSeq += 1;
			return;
		}
		this.watch = reduceWatch(this.watch, { type: 'start' });
		this.recentreSeq += 1;
		this.#register();
		this.#timer ??= setInterval(() => {
			this.#tick();
		}, TICK_MS);
	}

	stop(): void {
		this.#clear();
		if (this.#timer !== undefined) clearInterval(this.#timer);
		this.#timer = undefined;
		this.watch = reduceWatch(this.watch, { type: 'stop' });
		this.trail = [];
		this.course = { kind: 'unknown' };
	}

	recentre(): void {
		this.recentreSeq += 1;
	}

	setWindow(next: TrailWindow): void {
		this.window = next;
		this.trail = trimTrail(this.trail, next, Date.now());
	}

	/** Called on teardown, and safe to call when nothing was ever started. */
	dispose(): void {
		this.#clear();
		if (this.#timer !== undefined) clearInterval(this.#timer);
		this.#timer = undefined;
	}

	#register(): void {
		this.#clear();
		this.#lastCallbackAt = Date.now();
		this.#watchId = navigator.geolocation.watchPosition(
			(position) => {
				this.#onCallback();
				const fix = toFix(position, this.#lastFixAt);
				if (fix === undefined) return;
				this.#lastFixAt = fix.at;
				this.#apply({ type: 'fix', fix });
			},
			(error) => {
				this.#onCallback();
				this.#apply({
					type: 'fail',
					failure:
						error.code === error.PERMISSION_DENIED
							? 'denied'
							: error.code === error.TIMEOUT
								? 'timeout'
								: 'unavailable',
					at: Date.now()
				});
				// A denial is the one failure that leaves nothing to wait for, and the
				// platform will keep answering every retry the same way until the user
				// changes a browser setting.
				if (error.code === error.PERMISSION_DENIED) this.#clear();
			},
			OPTIONS
		);
	}

	#clear(): void {
		if (this.#watchId !== undefined) navigator.geolocation.clearWatch(this.#watchId);
		this.#watchId = undefined;
	}

	#onCallback(): void {
		this.#lastCallbackAt = Date.now();
	}

	#apply(event: WatchEvent): void {
		const next = reduceWatch(this.watch, event);
		this.watch = next;
		if (next.status !== 'tracking') return;
		const grown = appendFix(this.trail, next.fix);
		this.trail = trimTrail(grown, this.window, next.fix.at);
		this.course = estimateCourse(this.trail, this.course);
	}

	#tick(): void {
		const now = Date.now();
		this.now = now;
		this.trail = trimTrail(this.trail, this.window, now);
		if (this.watch.status === 'denied' || this.watch.status === 'off') return;
		if (now - this.#lastCallbackAt > WATCHDOG_MS) {
			this.#apply({ type: 'fail', failure: 'timeout', at: now });
			this.#register();
		}
	}
}
