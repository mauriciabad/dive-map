import type {
	DataDrivenPropertyValueSpecification,
	FilterSpecification,
	LayerSpecification,
	LineLayerSpecification
} from 'maplibre-gl';
import { PALETTE } from './palette.ts';

/**
 * Where the rock stops and the sand starts, drawn as a line. Issue #48, and the
 * half of it the owner put as a question rather than a request: "i dont know if
 * this is a good idea or useful, i would have to see it in action to decide".
 *
 * So it is built to be judged and it ships switched off. Nothing else on the map
 * changes when it is on or off, and the switch is one row in the layers panel
 * next to the ground it is drawn from.
 *
 * The line is the boundary of the rocky classes in the ICGC seafloor type
 * product, which is a different survey from the habitat one and a different
 * question: `CODI_FONS` is what the acoustic return says the ground is made of,
 * not what is living on it. A diver swimming out from a reef crosses this line at
 * the moment the wall gives way to the sand plain, which is the thing that is
 * hard to see coming on a map of contours alone.
 *
 * Three codes and not the rest. Rock and sediment-veneered rock are the two that
 * make the reef; biogenic reef is coralligenous build-up, which is hard ground
 * grown rather than laid, and a diver reads it as rock. Anthropogenic rock,
 * artificial reefs, wrecks and mooring blocks are all hard ground too and all of
 * them are already marked as what they are, so drawing a rock edge round a wreck
 * would say something the chart mark says better.
 *
 * Dashed, and that is the honest part. The survey classifies a 10 m raster and a
 * polygon only has to be 75 per cent pure, so this boundary is within a cell or
 * two of where the ground actually changes and sometimes further. A solid line
 * would claim a precision the survey does not have; a broken one reads as a
 * limit, which is what a chart uses a dashed line for and what this is.
 *
 * Amber over a dark casing, which is the same two-layer trick the contours use
 * and for the same reason. Drawn as one brass line under the isobaths it was
 * invisible: measured over the Medes at z15 it put 12,407 pixels on screen and
 * not one of them could be picked out of a metre-interval contour set. The seabed
 * it has to be read against is painted and the depth ramp has taken most of the
 * wheel, so amber is what is left that a diver already reads as a chart mark
 * rather than as a depth.
 */

export const ROCK_EDGE_LAYER_ID = 'rock-edge';
const ROCK_EDGE_CASING_ID = 'rock-edge-casing';

/** `CODI_FONS` for hard ground a diver reads as reef. */
const ROCKY = ['301', '302', '30202'];

/**
 * Over the contours, because a line nobody can find is a line nobody can judge,
 * and under the depths and the chart marks, which are what a briefing is about.
 *
 * Both grounds are in the style at once and only one is drawn, so this rides the
 * smoothed archive alone: it is the one the map draws by default, and the raw one
 * is the survey's own 10 m staircase, which as a line is a sawtooth rather than a
 * boundary.
 */
export const rockEdgeLayers = (visible: boolean): readonly LayerSpecification[] => {
	const shared = {
		type: 'line',
		source: 'substrate',
		'source-layer': 'substrate',
		minzoom: 12,
		filter: ['in', ['get', 'code'], ['literal', ROCKY]] as FilterSpecification,
		layout: { visibility: visible ? 'visible' : 'none', 'line-join': 'round', 'line-cap': 'butt' }
	} satisfies Omit<LineLayerSpecification, 'id'>;
	const width = (extra: number): DataDrivenPropertyValueSpecification<number> => [
		'interpolate',
		['linear'],
		['zoom'],
		12,
		1.4 + extra,
		16,
		2.2 + extra,
		18,
		3 + extra
	];
	// Dash lengths are multiples of the line width, so the pattern would stretch
	// with the casing and stop lining up with the line it sits under. These are the
	// casing's own numbers, scaled so both patterns land on the same seabed.
	const DASH: readonly [number, number] = [3, 1.7];
	return [
		{
			...shared,
			id: ROCK_EDGE_CASING_ID,
			paint: {
				'line-color': PALETTE.isobathMajor,
				'line-width': width(1.6),
				'line-dasharray': [DASH[0] * 0.66, DASH[1] * 0.66],
				'line-opacity': 0.75
			}
		},
		{
			...shared,
			id: ROCK_EDGE_LAYER_ID,
			paint: {
				'line-color': PALETTE.buoy,
				'line-width': width(0),
				'line-dasharray': [...DASH],
				'line-opacity': 0.95
			}
		}
	];
};
