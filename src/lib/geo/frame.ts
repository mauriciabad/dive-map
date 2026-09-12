import type { ExpressionSpecification } from 'maplibre-gl';
import { type Course, heldCourse, predictionM } from './course.ts';
import { destination } from './geodesy.ts';
import { type TrailPoint, type TrailWindow, gradientStops } from './trail.ts';
import type { AvatarId } from './avatars.ts';
import type { Fix } from './fix.ts';
import { PALETTE } from '$lib/map/palette';

/**
 * One pure function from "what the tracker knows" to "what the two map sources
 * hold". Everything the map is ever told goes through here, which is what makes
 * the whole render path testable in node and makes re-pushing after a style
 * rebuild a matter of calling it again.
 */

export interface FrameInput {
	readonly fix: Fix | undefined;
	readonly stale: boolean;
	readonly course: Course;
	readonly avatar: AvatarId;
	readonly trail: readonly TrailPoint[];
	readonly window: TrailWindow;
	readonly showTrail: boolean;
	readonly showTrajectory: boolean;
}

export interface MapFrame {
	readonly position: GeoJSON.FeatureCollection;
	readonly trail: GeoJSON.FeatureCollection;
	/** Undefined when there is no trail to paint; the layer is then empty anyway. */
	readonly gradient: ExpressionSpecification | undefined;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const rgb = (hex: string): readonly [number, number, number] => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16)
];

const TRAIL_RGB = rgb(PALETTE.shallow);

const rgba = (alpha: number): string =>
	`rgba(${TRAIL_RGB[0]}, ${TRAIL_RGB[1]}, ${TRAIL_RGB[2]}, ${alpha.toFixed(3)})`;

/**
 * A one-stop gradient is not a gradient, and MapLibre rejects `interpolate` with
 * fewer than two stops outright, taking the layer with it.
 */
export const gradientFor = (
	stops: readonly (readonly [number, number])[]
): ExpressionSpecification | undefined => {
	if (stops.length < 2) return undefined;
	const ramp: (number | string)[] = [];
	for (const [progress, alpha] of stops) ramp.push(progress, rgba(alpha));
	return ['interpolate', ['linear'], ['line-progress'], ...ramp] as ExpressionSpecification;
};

export const buildFrame = (input: FrameInput): MapFrame => {
	const { fix, course, trail, window } = input;
	if (fix === undefined) return { position: EMPTY, trail: EMPTY, gradient: undefined };

	const features: GeoJSON.Feature[] = [
		{
			type: 'Feature',
			properties: {
				kind: 'position',
				avatar: input.avatar,
				// Holding the last course keeps the boat pointing the way it was last
				// seen going, rather than snapping north the moment it slows down.
				course: heldCourse(course) ?? 0,
				stale: input.stale
			},
			geometry: { type: 'Point', coordinates: [fix.lng, fix.lat] }
		}
	];

	// No line while stopped. A course over ground of nothing is not a direction,
	// and drawing the last one as if it were current is the kind of confident
	// wrong answer this map is not allowed to give.
	if (input.showTrajectory && course.kind === 'steaming') {
		const ahead = destination(fix, course.deg, predictionM(course.speedMs));
		features.push({
			type: 'Feature',
			properties: { kind: 'trajectory' },
			geometry: {
				type: 'LineString',
				coordinates: [
					[fix.lng, fix.lat],
					[ahead.lng, ahead.lat]
				]
			}
		});
	}

	const position: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
	if (!input.showTrail || trail.length < 2) {
		return { position, trail: EMPTY, gradient: undefined };
	}

	const gradient = gradientFor(gradientStops(trail, window));
	if (gradient === undefined) return { position, trail: EMPTY, gradient: undefined };

	return {
		position,
		trail: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'LineString',
						coordinates: trail.map((p) => [p.lng, p.lat])
					}
				}
			]
		},
		gradient
	};
};
