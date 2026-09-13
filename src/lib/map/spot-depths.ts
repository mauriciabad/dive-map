import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { IconName } from '$lib/ui/icons';
import { PALETTE } from './palette.ts';

/**
 * Depths written across the seabed rather than along the contours. Issue #48.
 *
 * A ring of isobaths does not say whether it is a rock or a hole, and reading it
 * off the colours means finding the ramp in your head first. The answer
 * cartography settled on a long time ago is the spot height, and the hydrographic
 * half of it is the sounding: one number, off the line, at the place the lines
 * are drawn around. Both put it at a local extreme, along a ridge or a valley
 * floor, or in the middle of a plain, and that is exactly the list the owner
 * arrived at from looking at this map.
 *
 * `pipeline/scripts/find_spot_depths.py` is where the places come from and where
 * the reasoning about prominence lives; `choose_spot_depths.py` is where each one
 * gets the zoom it first appears at. Everything here is the drawing.
 *
 * The mark is the direction and the number is the depth. A triangle pointing up
 * is ground standing proud of what surrounds it, pointing down is ground dented
 * into it, and a bar is ground with no relief to read at all. That is the one
 * thing a contour label cannot say and the whole reason this layer exists, so it
 * is carried by a shape rather than by a colour: the seabed under it is painted,
 * the depth ramp already owns most of the wheel, and a boat in sunlight is not
 * where a hue difference gets noticed.
 */

/** What the archive's `k` carries. */
export type SpotKind = 'shoal' | 'pit' | 'crest' | 'canyon' | 'flat';

export const SPOT_SOURCE_ID = 'spot-depths';
export const SPOT_LAYER_ID = 'spot-depth';

/**
 * The zoom the archive itself starts at. Below it the whole coast is in frame,
 * and the build has already worked out that a frame that wide has room for about
 * five numbers; there is no tile under 10 to read.
 */
export const SPOT_FROM = 10;

/**
 * Which drawing each kind takes, and the reason there are three rather than five.
 *
 * A summit and a ridge high point are the same news to a diver, that the ground
 * rises here, and so are a hollow and a valley floor. Separating them on the map
 * would spend a shape on a distinction only the algorithm cares about.
 */
const MARK: Readonly<Record<SpotKind, IconName>> = {
	shoal: 'spotHigh',
	crest: 'spotHigh',
	pit: 'spotLow',
	canyon: 'spotLow',
	flat: 'spotFlat'
};

export const spotImageId = (icon: IconName): string => `spot-${icon}`;

/** Every image this layer asks for by name, each one once. */
export const SPOT_IMAGES: readonly { readonly id: string; readonly icon: IconName }[] = [
	...new Set(Object.values(MARK))
].map((icon) => ({ id: spotImageId(icon), icon }));

const markFor = (): ExpressionSpecification => [
	'coalesce',
	[
		'get',
		['get', 'k'],
		[
			'literal',
			Object.fromEntries(Object.entries(MARK).map(([kind, icon]) => [kind, spotImageId(icon)]))
		]
	],
	spotImageId('spotFlat')
];

export interface SpotDepthOptions {
	readonly visible: boolean;
	/** The same limit the contours obey, so one setting governs every depth drawn. */
	readonly maxDepthM: number;
}

/**
 * One symbol layer, mark and number together.
 *
 * They are one symbol rather than two layers so MapLibre's collision treats them
 * as the thing they are. Split apart, a number could be placed where its own mark
 * was dropped, which is the one failure worse than no label: a depth with nothing
 * saying which way the ground goes, sitting on a rock it is not about.
 *
 * Which labels survive a crowded frame is settled twice over, and neither half is
 * here. The tiles carry a per-feature minimum zoom, worked out so that no two
 * spot depths are ever closer than one label width at the scale either appears
 * at, so a half-metre bump is not even a candidate at a coast-wide zoom. What is
 * left to MapLibre is the collisions with everything else on the chart, and
 * `symbol-sort-key` decides those: the build writes each feature's position in
 * that same selection order, and MapLibre places the lowest key first.
 */
export const spotDepthLayers = (options: SpotDepthOptions): readonly LayerSpecification[] => [
	{
		id: SPOT_LAYER_ID,
		type: 'symbol',
		source: SPOT_SOURCE_ID,
		'source-layer': 'spots',
		minzoom: SPOT_FROM,
		filter: ['<=', ['to-number', ['get', 'd']], options.maxDepthM],
		layout: {
			visibility: options.visible ? 'visible' : 'none',
			'symbol-sort-key': ['to-number', ['get', 's']],
			'icon-image': markFor(),
			// Bigger than the mark needs to be read on its own, because what it has to
			// be read against is a contour label two centimetres away saying a number
			// in the same ink. The triangle is the whole of the difference between
			// "the depth along this line" and "the depth of this rock".
			'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.5, 18, 0.62],
			'icon-anchor': 'right',
			'icon-padding': 3,
			'text-field': ['concat', ['to-string', ['get', 'd']], ' m'],
			'text-font': ['Alegreya Sans Bold'],
			// A point past the contour labels at every zoom, for the same reason.
			'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 13, 18, 15],
			'text-anchor': 'left',
			// Ems of the text, so the gap between the mark and the number holds as
			// both grow with the zoom.
			'text-offset': [0.28, 0.04],
			'text-letter-spacing': 0.04,
			// Wider than the two pixels a label defaults to. These are scattered over
			// a chart that already carries contour labels and dive marks, and a number
			// touching another number is unreadable long before it overlaps one.
			'text-padding': 5
		},
		paint: {
			'text-color': PALETTE.paper,
			'text-halo-color': PALETTE.isobathMajor,
			'text-halo-width': 1.7,
			'icon-color': PALETTE.paper,
			'icon-halo-color': PALETTE.isobathMajor,
			'icon-halo-width': 1.5
		}
	}
];
