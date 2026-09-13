import { describe, expect, it } from 'vitest';
import { GROUND_DEPTH_LAYER, type StyleOptions, buildStyle } from './style.ts';
import { DEFAULT_ISOBATHS, DEFAULT_LAYERS, type LayerId } from '$lib/domain/card';
import { DANGER_TAG_PREFIX, DIVE_NUMBER_KEYS, DIVE_TAG_KEYS } from '$lib/domain/osm';

const options = (extra: Partial<StyleOptions> = {}): StyleOptions => ({
	locale: 'ca',
	isobaths: DEFAULT_ISOBATHS,
	visible: DEFAULT_LAYERS,
	groundLayer: 'habitats',
	smoothed: true,
	worldPainted: true,
	...extra
});

const withPhoto = (visible: readonly LayerId[]): readonly LayerId[] => [...visible, 'satellite'];

const paintOf = (style: StyleOptions, id: string): Record<string, unknown> => {
	const layer = buildStyle(style).layers.find((l) => l.id === id);
	if (layer === undefined || !('paint' in layer)) throw new Error(`no paint on ${id}`);
	return layer.paint;
};

/** The zoom-9 and zoom-13 stops out of the ground fill's interpolate expression. */
const groundStops = (style: StyleOptions): readonly number[] => {
	const opacity = paintOf(style, 'ground-habitats-fill')['fill-opacity'];
	if (!Array.isArray(opacity)) throw new Error('ground opacity is not an expression');
	return [opacity[4], opacity[6]] as number[];
};

describe('the ortophoto and the paint over it', () => {
	const withSatellite = (extra: Partial<StyleOptions> = {}): StyleOptions =>
		options({ visible: withPhoto(DEFAULT_LAYERS), ...extra });

	it('leaves the seabed at full paint when the photograph is off', () => {
		expect(groundStops(options())).toEqual([0.55, 0.92]);
	});

	/**
	 * The owner's words: the marine habitats are not overlapping the IGN map. They
	 * were not, because turning the photograph on used to step the seabed paint back
	 * to a third of itself. The photograph is the bottom of the stack and the survey
	 * is the subject, so by default nothing over the water changes at all.
	 */
	it('keeps every bit of the habitat paint over the photograph by default', () => {
		expect(groundStops(withSatellite())).toEqual([0.55, 0.92]);
	});

	it('steps the seabed back only when a diver asks it to', () => {
		const at = (seabedPaint: 0 | 0.25 | 0.5 | 0.75 | 1) =>
			groundStops(withSatellite({ seabedPaint }))[1] ?? -1;
		expect(at(1)).toBeGreaterThan(at(0.75));
		expect(at(0.75)).toBeGreaterThan(at(0.5));
		expect(at(0.5)).toBeGreaterThan(at(0.25));
		expect(at(0)).toBe(0);
	});

	it('never dims the photograph itself, whatever the paint says', () => {
		for (const seabedPaint of [0, 0.5, 1] as const) {
			expect(paintOf(withSatellite({ seabedPaint }), 'satellite')['raster-opacity']).toBe(1);
		}
	});

	/**
	 * This used to assert that the land never fades, on the theory that fading both
	 * land fills would band along the four kilometre overlap the world tiles slide
	 * under the ICGC polygon. It was also the reason the photograph never appeared.
	 * The band does not happen: checked at z9 across the whole Barcelona coast with
	 * the land handed over completely, there is no seam, because both fills carry
	 * the same colour and the land under them is opaque either way.
	 */
	it('hands the land to the photograph by default, which is the point of the switch', () => {
		expect(paintOf(withSatellite(), 'land')['fill-opacity']).toBe(0);
		expect(paintOf(withSatellite({ landPaint: 1 }), 'land')['fill-opacity']).toBe(1);
		expect(paintOf(withSatellite({ landPaint: 0.5 }), 'land')['fill-opacity']).toBe(0.5);
	});

	it('paints the land solid again the moment the photograph goes off', () => {
		expect(paintOf(options(), 'land')['fill-opacity']).toBe(1);
	});
});

describe('isobath contrast', () => {
	it('drops a soft shadow under the contours over the painted seabed', () => {
		const casing = paintOf(options(), 'isobath-glow');
		expect(casing['line-translate']).toEqual([0, 1.6]);
		expect(casing['line-color']).toBe('rgba(4, 16, 24, 0.55)');
	});

	it('turns the shadow into a centred casing wider than the line over the photograph', () => {
		const casing = paintOf(options({ visible: withPhoto(DEFAULT_LAYERS) }), 'isobath-glow');
		expect(casing['line-translate']).toEqual([0, 0]);

		const width = casing['line-width'];
		const line = paintOf(options({ visible: withPhoto(DEFAULT_LAYERS) }), 'isobath')['line-width'];
		if (!Array.isArray(width) || !Array.isArray(line))
			throw new Error('widths are not expressions');
		// The thinnest contour at the widest zoom: the casing has to be proud of it.
		const thinnest = (expression: unknown[]): number => {
			const stop = expression[6];
			return Array.isArray(stop) ? (stop[4] as number) : 0;
		};
		expect(thinnest(width)).toBeGreaterThan(thinnest(line));
	});
});

describe('the sea flourishes', () => {
	const flourish = (visible: readonly LayerId[]) =>
		buildStyle(options({ visible })).layers.find((l) => l.id === 'sea-flourish');

	it('draws only on the water the survey never reached', () => {
		const layer = flourish(DEFAULT_LAYERS);
		if (layer?.type !== 'fill') throw new Error('no flourish fill');
		expect(layer.filter).toEqual(['==', ['get', 'kind'], 'beyond']);
		expect(layer.source).toBe('dem-edge');
	});

	it('goes out when the coastline does, because land is inside `beyond` too', () => {
		const withoutCoast = DEFAULT_LAYERS.filter((id) => id !== 'coastline');
		expect(flourish(withoutCoast)?.layout?.visibility).toBe('none');
		expect(flourish(DEFAULT_LAYERS)?.layout?.visibility).toBe('visible');
	});

	it('has faded to nothing by the zoom a dive is briefed at', () => {
		const layer = flourish(DEFAULT_LAYERS);
		if (layer?.type !== 'fill') throw new Error('no flourish fill');
		const opacity = layer.paint?.['fill-opacity'];
		if (!Array.isArray(opacity)) throw new Error('flourish opacity is not an expression');
		expect(opacity.at(-2)).toBeGreaterThanOrEqual(14);
		expect(opacity.at(-1)).toBe(0);
	});
});

describe('what the osm layers read off a feature', () => {
	// Two-argument `['get', key]` only. The three-argument form is a lookup into a
	// literal object and its second argument is a kind, not a property name.
	const readKeys = (node: unknown, into: Set<string>): void => {
		if (Array.isArray(node)) {
			if (node.length === 2 && node[0] === 'get' && typeof node[1] === 'string') into.add(node[1]);
			for (const child of node) readKeys(child, into);
			return;
		}
		if (typeof node === 'object' && node !== null) {
			for (const value of Object.values(node)) readKeys(value, into);
		}
	};

	const keysRead = (): Set<string> => {
		const keys = new Set<string>();
		for (const layer of buildStyle(options()).layers) {
			if ('source' in layer && layer.source === 'osm') readKeys(layer, keys);
		}
		return keys;
	};

	it('draws the depth off the number, not the raw tag', () => {
		expect(keysRead().has('maxDepth')).toBe(true);
	});

	it('reads nothing the reduction does not write', () => {
		const emitted: readonly string[] = ['t', 'id', 'kind', ...DIVE_NUMBER_KEYS, ...DIVE_TAG_KEYS];
		for (const key of keysRead()) {
			if (key.startsWith(DANGER_TAG_PREFIX)) continue;
			expect(emitted).toContain(key);
		}
	});
});

describe('the hillshade over the DEM nodata plane', () => {
	const visibilityOf = (extra: Partial<StyleOptions>): unknown => {
		const layer = buildStyle(options(extra)).layers.find((l) => l.id === 'hillshade');
		if (layer === undefined) throw new Error('no hillshade layer');
		return layer.layout?.visibility;
	};

	it('stays dark until the land that covers the plane has painted', () => {
		expect(visibilityOf({ worldPainted: false })).toBe('none');
	});

	it('lights up once the land is down', () => {
		expect(visibilityOf({ worldPainted: true })).toBe('visible');
	});

	it('stays off when the diver turned it off, painted or not', () => {
		const without = DEFAULT_LAYERS.filter((id) => id !== 'hillshade');
		expect(visibilityOf({ worldPainted: true, visible: without })).toBe('none');
		expect(visibilityOf({ worldPainted: false, visible: without })).toBe('none');
	});
});

describe('every flat wash on the land side of the shore', () => {
	const FLAT_WASHES = [
		'land',
		'land-texture',
		'world-land',
		'world-land-texture',
		'land-sand',
		// Its polygon is the survey's complement, which is the whole interior, so it
		// is the first thing that buried the photograph and it goes with the land.
		'sea-beyond-dem'
	];

	const withSatellite = (landPaint: 0 | 1): StyleOptions =>
		options({ visible: withPhoto(DEFAULT_LAYERS), landPaint });

	it('clears for the photograph when the land is handed over', () => {
		for (const id of FLAT_WASHES) {
			expect(paintOf(withSatellite(0), id)['fill-opacity']).toBe(0);
		}
	});

	it('stays solid when a diver keeps the painted land', () => {
		for (const id of FLAT_WASHES) {
			expect(paintOf(withSatellite(1), id)['fill-opacity']).not.toBe(0);
			expect(paintOf(options(), id)['fill-opacity']).not.toBe(0);
		}
	});

	it('keeps the lines a diver reads the photograph with', () => {
		expect(paintOf(withSatellite(0), 'world-coast')['line-opacity']).toBe(0.8);
		expect(paintOf(withSatellite(0), 'land-road')['line-opacity']).toBeDefined();
	});
});

describe('the surveyed depth the card reads', () => {
	// Picking Seafloor type in the panel switches `groundLayer` and adds `substrate`
	// to the visible set, so both move together and a test of one is a lie.
	const SEAFLOOR_TYPE: Partial<StyleOptions> = {
		groundLayer: 'substrate',
		visible: [...DEFAULT_LAYERS, 'substrate']
	};

	const probe = (extra: Partial<StyleOptions> = {}) =>
		buildStyle(options(extra)).layers.find((l) => l.id === GROUND_DEPTH_LAYER);

	it('is in the style whichever ground is drawn, so a query can always name it', () => {
		expect(probe({ groundLayer: 'habitats' })).toBeDefined();
		expect(probe(SEAFLOOR_TYPE)).toBeDefined();
	});

	it('reads the habitat polygons, which are the only ones carrying a depth', () => {
		const layer = probe(SEAFLOOR_TYPE);
		if (layer?.type !== 'fill') throw new Error('no depth probe fill');
		expect(layer.source).toBe('habitats');
		expect(layer['source-layer']).toBe('habitats');
		expect(layer.paint?.['fill-opacity']).toBe(0);
	});

	it('turns on for seafloor type, where nothing drawn carries a depth', () => {
		expect(probe(SEAFLOOR_TYPE)?.layout?.visibility).toBe('visible');
	});

	it('stays off for habitats, whose own fill is already queryable', () => {
		expect(probe({ groundLayer: 'habitats' })?.layout?.visibility).toBe('none');
	});

	it('stays off with the ground switched off, rather than fetching tiles for nothing', () => {
		const noGround = DEFAULT_LAYERS.filter((id) => id !== 'habitats');
		expect(probe({ groundLayer: 'substrate', visible: noGround })?.layout?.visibility).toBe(
			'none'
		);
	});
});
