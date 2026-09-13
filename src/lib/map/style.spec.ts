import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import {
	GROUND_BY_LAYER,
	PHOTOGRAPHS,
	type LayerWriter,
	type StyleOptions,
	applyIsobathLayers,
	buildStyle,
	isobathLayersOf
} from './style.ts';
import {
	DEFAULT_ISOBATHS,
	DEFAULT_LAYERS,
	type IsobathStyle,
	type LayerId
} from '$lib/domain/card';
import type { Ground } from '$lib/domain/habitat';
import {
	DEFAULT_HALO,
	DEFAULT_PAINT,
	type IsobathHalo,
	withColour,
	withEmphasis
} from '$lib/domain/isobaths';
import { DANGER_TAG_PREFIX, DIVE_NUMBER_KEYS, DIVE_TAG_KEYS } from '$lib/domain/osm';
import { MARKER_CLOSE } from './markers.ts';

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

const withHalo = (halo: Partial<IsobathHalo>): IsobathStyle => ({
	...DEFAULT_ISOBATHS,
	paint: { ...DEFAULT_PAINT, halo: { ...DEFAULT_HALO, ...halo } }
});

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
	 * This used to assert the opposite, that the seabed keeps every bit of its paint
	 * over the photograph, so the survey stayed the subject of its own map. The
	 * owner tested it in prod and reported the photograph missing, which it was:
	 * habitat fill at 0.55 to 0.92 opacity is not something a picture shows through.
	 * A switch asking for a photograph now produces one.
	 */
	it('hands the seabed to the photograph by default, which is the point of the switch', () => {
		expect(groundStops(withSatellite())).toEqual([0, 0]);
	});

	it('paints the seabed back up as a diver drags the slider', () => {
		const at = (seabedPaint: number) => groundStops(withSatellite({ seabedPaint }))[1] ?? -1;
		expect(at(1)).toBeGreaterThan(at(0.63));
		expect(at(0.63)).toBeGreaterThan(at(0.25));
		expect(at(0)).toBe(0);
	});

	it('never dims the photograph itself, whatever the paint says', () => {
		for (const seabedPaint of [0, 0.5, 1] as const) {
			expect(paintOf(withSatellite({ seabedPaint }), 'satellite')['raster-opacity']).toBe(1);
		}
	});

	/**
	 * The owner asked for ICGC four times and kept getting IGN. Twice the cause was
	 * a template that served no tile, and once it was `orto-costa` on its own: that
	 * layer is a ribbon along the shore, so a few kilometres inland every tile came
	 * back as the 334-byte transparent no-data PNG and the whole screen fell through
	 * to PNOA under a credit line naming ICGC.
	 *
	 * The answer the owner chose is these two and no others. PNOA carries the land
	 * because it is the only one of the four with any, and the 5 cm coastal flight
	 * carries the water. So this ordering is the feature, not an accident.
	 */
	it('draws the 5 cm coastal photograph over the national one by default', () => {
		const ids = buildStyle(withSatellite()).layers.map((l) => l.id);
		expect(ids.indexOf('satellite-icgc-bathymetry')).toBeGreaterThan(ids.indexOf('satellite'));
	});

	it('puts up those two and leaves the other photographs down', () => {
		const up = (id: string) =>
			buildStyle(withSatellite()).layers.find((l) => l.id === id)?.layout?.visibility;
		expect(up('satellite')).toBe('visible');
		expect(up('satellite-icgc-bathymetry')).toBe('visible');
		expect(up('satellite-icgc-territorial')).toBe('none');
		expect(up('satellite-icgc')).toBe('none');
	});

	/**
	 * A picker stores a set, never an order. Listing a 25 cm photograph after the
	 * 5 cm one must not put it on top, so the stack is always drawn in catalogue
	 * order and the option is read as membership.
	 */
	it('paints picked photographs coarsest first whatever order they were asked for', () => {
		const ids = buildStyle(
			withSatellite({ photographs: ['satellite-icgc-bathymetry', 'satellite-icgc-territorial'] })
		).layers.map((l) => l.id);
		expect(ids.indexOf('satellite-icgc-bathymetry')).toBeGreaterThan(
			ids.indexOf('satellite-icgc-territorial')
		);
	});

	it('lets a diver ask for a photograph the default leaves out', () => {
		const layer = buildStyle(
			withSatellite({ photographs: ['satellite-icgc'] })
		).layers.find((l) => l.id === 'satellite-icgc');
		expect(layer?.layout?.visibility).toBe('visible');
	});

	/**
	 * Every photograph stays in the style and the unpicked ones are merely hidden,
	 * so turning one back on is a visibility diff rather than a style rebuild that
	 * would drop every warm tile on screen.
	 */
	it('keeps every photograph in the style whatever the picker says', () => {
		const ids = buildStyle(withSatellite({ photographs: [] })).layers.map((l) => l.id);
		for (const photo of PHOTOGRAPHS) expect(ids).toContain(photo.id);
	});

	it('puts every photograph away together', () => {
		for (const photo of PHOTOGRAPHS) {
			const layer = buildStyle(options()).layers.find((l) => l.id === photo.id);
			expect(layer?.layout?.visibility).toBe('none');
		}
	});

	/**
	 * The outline exists because a photograph puts the contours over ground nobody
	 * chose. It started near-opaque black, which fixed the pale bands over bright
	 * sand and lost every line over dark water. White at part opacity is the
	 * owner's call, and it is the default a diver lands on.
	 */
	it('carries a white part-opacity outline under the contours when it is on', () => {
		const paint = paintOf(withSatellite({ isobaths: withHalo({ on: true }) }), 'isobath-glow');
		expect(paint['line-color']).toBe('#ffffff');
		expect(paint['line-opacity']).toBe(0.2);
	});

	it('drops back to the shadow when the outline is switched off', () => {
		const off = paintOf(withSatellite({ isobaths: withHalo({ on: false }) }), 'isobath-glow');
		expect(off['line-color']).toBe('rgba(4, 16, 24, 0.55)');
		expect(off['line-opacity']).toBe(1);
		expect(off['line-translate']).toEqual([0, 1.6]);
	});

	it('takes the colour and the strength a diver picked', () => {
		const paint = paintOf(
			withSatellite({ isobaths: withHalo({ on: true, colour: '#02090e', opacity: 0.92 }) }),
			'isobath-glow'
		);
		expect(paint['line-color']).toBe('#02090e');
		expect(paint['line-opacity']).toBe(0.92);
	});

	/**
	 * The outline is the switch's business and no longer the photograph's. A diver
	 * who draws it over the chart gets it over the chart, which is what makes
	 * `MapState` and not this expression the thing that answers to the base map.
	 */
	it('draws the outline over the chart as well when it is on', () => {
		const chart = paintOf(options({ isobaths: withHalo({ on: true }) }), 'isobath-glow');
		expect(chart['line-color']).toBe('#ffffff');
		expect(chart['line-opacity']).toBe(0.2);
		expect(chart['line-translate']).toEqual([0, 0]);
	});

	/**
	 * `depth-tint` drives the veil and the wash over sea past the survey's edge. The
	 * veil alone used to carry an "off whenever the photograph is on" clause, so the
	 * wash kept painting with its switch gone from the panel. `MapState` takes the
	 * switch down instead, and these two now answer to it together.
	 */
	it('leaves the veil and the wash reading one switch, with no clause of their own', () => {
		for (const id of ['depth-veil', 'sea-beyond-dem']) {
			const on = buildStyle(withSatellite()).layers.find((l) => l.id === id);
			const off = buildStyle(withSatellite({ visible: ['satellite'] })).layers.find(
				(l) => l.id === id
			);
			expect([on?.layout?.visibility, off?.layout?.visibility]).toEqual(['visible', 'none']);
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

	it('turns the shadow into a centred casing wider than the line when the outline is on', () => {
		const drawn = options({ visible: withPhoto(DEFAULT_LAYERS), isobaths: withHalo({ on: true }) });
		const casing = paintOf(drawn, 'isobath-glow');
		expect(casing['line-translate']).toEqual([0, 0]);

		const width = casing['line-width'];
		const line = paintOf(drawn, 'isobath')['line-width'];
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

describe('the ground both halves of the card read', () => {
	// Picking Seafloor type in the panel switches `groundLayer` and adds `substrate`
	// to the visible set, so both move together and a test of one is a lie.
	const SEAFLOOR_TYPE: Partial<StyleOptions> = {
		groundLayer: 'substrate',
		visible: [...DEFAULT_LAYERS, 'substrate']
	};

	const probe = (ground: Ground, extra: Partial<StyleOptions> = {}) =>
		buildStyle(options(extra)).layers.find((l) => l.id === `ground-${ground}-probe`);

	it('is in the style whichever ground is drawn, so a query can always name it', () => {
		for (const ground of ['habitats', 'substrate'] as const) {
			expect(probe(ground, { groundLayer: 'habitats' })).toBeDefined();
			expect(probe(ground, SEAFLOOR_TYPE)).toBeDefined();
		}
	});

	it('reads its own catalogue at zero opacity, drawing nothing and still answering', () => {
		const layer = probe('habitats', SEAFLOOR_TYPE);
		if (layer?.type !== 'fill') throw new Error('no habitat probe fill');
		expect(layer.source).toBe('habitats');
		expect(layer['source-layer']).toBe('habitats');
		expect(layer.paint?.['fill-opacity']).toBe(0);
	});

	it('turns on for the catalogue nobody is looking at, which is the one not queryable', () => {
		expect(probe('habitats', SEAFLOOR_TYPE)?.layout?.visibility).toBe('visible');
		expect(probe('substrate', { groundLayer: 'habitats' })?.layout?.visibility).toBe('visible');
	});

	it('stays off for the ground being drawn, whose own fill is already queryable', () => {
		expect(probe('habitats', { groundLayer: 'habitats' })?.layout?.visibility).toBe('none');
		expect(probe('substrate', SEAFLOOR_TYPE)?.layout?.visibility).toBe('none');
	});

	it('stays off with the ground switched off, rather than fetching tiles for nothing', () => {
		const noGround = DEFAULT_LAYERS.filter((id) => id !== 'habitats');
		expect(probe('substrate', { visible: noGround })?.layout?.visibility).toBe('none');
		expect(probe('habitats', { visible: noGround })?.layout?.visibility).toBe('none');
	});

	it('names only layers the style really has, so a tap never queries a ghost', () => {
		const built = new Set(buildStyle(options()).layers.map((l) => l.id));
		for (const id of Object.keys(GROUND_BY_LAYER)) expect(built.has(id)).toBe(true);
	});
});

describe('the 0 m line the isobath panel can now ask for', () => {
	const drawsDepth = (style: StyleOptions, depth: number): boolean => {
		const layer = buildStyle(style).layers.find((l) => l.id === 'isobath');
		if (layer?.type !== 'line') throw new Error('no isobath line layer');
		const spec = layer.filter;
		if (spec === undefined) throw new Error('no isobath filter');
		const { filter } = featureFilter(spec, 'layers[0].filter');
		return filter({ zoom: 14 }, { type: 2, properties: { depth } });
	};

	const emphasising = (...depths: readonly number[]): StyleOptions =>
		options({ isobaths: { ...DEFAULT_ISOBATHS, emphasised: depths, autoInterval: false } });

	/**
	 * The shoreline is this same contour, so 0 m is a depth the panel offers like
	 * any other. It used to be excluded from this filter outright.
	 */
	it('draws 0 m when it is asked for', () => {
		expect(drawsDepth(emphasising(0, 18), 0)).toBe(true);
	});

	it('leaves 0 m out when it is not, rather than always drawing it twice', () => {
		expect(drawsDepth(emphasising(18), 0)).toBe(false);
	});

	it('still draws the depths it always did', () => {
		expect(drawsDepth(emphasising(0, 18), 18)).toBe(true);
	});
});

/**
 * The national contours arrived on their own layers with a ladder and a weight
 * rule of their own, so the isobath panel described half the contours on screen.
 * A diver setting an interval saw it ignored below 50 m. Both sets read one set
 * of expressions now.
 */
describe('the isobath settings the national contours answer to', () => {
	const draws = (id: string, style: StyleOptions, depth: number, zoom = 14): boolean => {
		const layer = buildStyle(style).layers.find((l) => l.id === id);
		const spec = layer !== undefined && 'filter' in layer ? layer.filter : undefined;
		if (spec === undefined) throw new Error(`no filter on ${id}`);
		const { filter } = featureFilter(spec, 'layers[0].filter');
		return filter({ zoom }, { type: 2, properties: { depth } });
	};

	const cut = (extra: Partial<IsobathStyle>): StyleOptions =>
		options({ isobaths: { ...DEFAULT_ISOBATHS, autoInterval: false, ...extra } });

	it('cuts the deep lines to the interval the panel is set to', () => {
		const every25 = cut({ intervalM: 25 });
		expect(draws('isobath-deep', every25, 75)).toBe(true);
		expect(draws('isobath-deep', every25, 65)).toBe(false);
		expect(draws('isobath-deep', cut({ intervalM: 5 }), 65)).toBe(true);
	});

	it('stops the deep lines where the maximum depth stops', () => {
		const shallow = cut({ maxDepthM: 60 });
		expect(draws('isobath-deep', shallow, 55)).toBe(true);
		expect(draws('isobath-deep', shallow, 65)).toBe(false);
	});

	it('keeps a marked depth past the interval, out there as well as inshore', () => {
		const coarse = cut({ intervalM: 20, emphasised: [30, 175] });
		expect(draws('isobath-deep', coarse, 175)).toBe(true);
		expect(draws('isobath', coarse, 30)).toBe(true);
	});

	it('names the deep lines a diver marked and no others', () => {
		const marked = cut({ emphasised: [50, 100], intervalM: 5 });
		expect(draws('isobath-deep-label', marked, 100)).toBe(true);
		expect(draws('isobath-deep-label', marked, 150)).toBe(false);
	});

	/**
	 * The archive carries five metre steps on the shelf and fifty down the slope,
	 * so an interval it has no line for draws nothing out there. That is the data
	 * rather than the expression, and it is water past any scuba plan.
	 */
	it('ships reaching the national survey floor rather than the ICGC one', () => {
		expect(DEFAULT_ISOBATHS.maxDepthM).toBe(250);
		expect(draws('isobath-deep', options(), 250, 16)).toBe(true);
	});
});

/**
 * The bug: at the whole-coast view every dive site on two hundred kilometres was
 * inside one frame, and 47 discs drew on top of each other around one headland.
 * Key marks now give way to each other out there, which is only safe while the
 * plate is not drawn, because the plate is a second layer over the glyph and the
 * two can never agree about which of them collided.
 */
describe('the dive site out where the whole coast is on screen', () => {
	const layerAt = (id: string) => {
		const layer = buildStyle(options()).layers.find((l) => l.id === id);
		if (layer === undefined) throw new Error(`no layer ${id}`);
		return layer;
	};

	it('draws nothing that cannot be dropped until the marks stop dropping', () => {
		for (const id of ['osm-marker-shadow', 'osm-marker-plate', 'osm-dive-site-label']) {
			expect(layerAt(id).minzoom).toBe(MARKER_CLOSE);
		}
	});

	it('lets a key mark give way outside that zoom and hold its pixels inside it', () => {
		const layer = layerAt('osm-marker-key');
		if (layer.type !== 'symbol') throw new Error('the key markers are not a symbol layer');
		expect(layer.layout?.['icon-allow-overlap']).toEqual([
			'step',
			['zoom'],
			false,
			MARKER_CLOSE,
			true
		]);
	});

	it('keeps thinning the furniture at every zoom it is drawn at', () => {
		const layer = layerAt('osm-marker-minor');
		if (layer.type !== 'symbol') throw new Error('the minor markers are not a symbol layer');
		expect(layer.layout?.['icon-allow-overlap']).toBe(false);
	});
});

// Issue #33. The substrate layer returns 30509, 30512 and 30513 for 41% of its
// features, and the map painted all of them with grass, because only the habitat
// catalogue defined them. Seafloor type asks what the bottom is made of, so it
// now paints what the survey's own TEXTURA field says is under the meadow.
describe('what each ground paints a seagrass code with', () => {
	const nth = (of: unknown, at: number): unknown =>
		Array.isArray(of) ? (of as unknown[])[at] : of;
	const patternOf = (groundLayer: 'habitats' | 'substrate', code: string): unknown => {
		const paint = paintOf(options({ groundLayer }), `ground-${groundLayer}-fill`);
		const lookup = nth(nth(nth(paint['fill-pattern'], 1), 2), 1);
		if (typeof lookup !== 'object' || lookup === null) throw new Error('no code lookup');
		return Object.entries(lookup).find(([at]) => at === code)?.[1];
	};

	it('paints Posidonia as grass on habitats and as rock under sediment on seafloor type', () => {
		expect(patternOf('habitats', '30512')).toBe('ch_grass');
		expect(patternOf('substrate', '30512')).toBe('ch_stone_pattern');
	});

	it('paints the two Cymodocea codes on the fine sediment the survey reads under them', () => {
		for (const code of ['30509', '30513']) {
			expect(patternOf('substrate', code)).toBe('ch_dirt_lines_02');
		}
	});
});

// The isobath settings reach a live map through their own six layers rather than
// through a style MapLibre has to diff, so that a dragged slider repaints at the
// frame rate. What must hold is that nothing else moves with them. The national
// contours are three of the six: they take their colour off the same ramp, so a
// painted band has to reach them in the same push.
describe('pushing the isobath layers at a live map', () => {
	const pushes = (from: StyleOptions, to: StyleOptions): readonly string[] => {
		const written: string[] = [];
		const writer: LayerWriter = {
			filter: (id) => written.push(`${id} filter`),
			paint: (id, property) => written.push(`${id} ${property}`),
			layout: (id, property) => written.push(`${id} ${property}`)
		};
		applyIsobathLayers(writer, buildStyle(to), isobathLayersOf(buildStyle(from)));
		return written;
	};

	it('writes only the colour when only a colour was painted', () => {
		const painted = { ...DEFAULT_ISOBATHS, ...withColour(DEFAULT_ISOBATHS, 18, '#123456') };
		expect(pushes(options(), options({ isobaths: painted }))).toEqual([
			'isobath-deep line-color',
			'isobath line-color'
		]);
	});

	it('writes the weight and the labels a line loses when its tick comes off', () => {
		const thin = withEmphasis(DEFAULT_ISOBATHS, 30, false);
		// Not the colour. A tick coming off a line changes what the line weighs and
		// whether it is labelled, and the band it governs keeps what it was painted.
		// Both contour sets move, because both read one list of marks now.
		expect(pushes(options(), options({ isobaths: thin }))).toEqual([
			'isobath-deep-glow line-width',
			'isobath-deep line-opacity',
			'isobath-deep line-width',
			'isobath-deep-label filter',
			'isobath-glow line-width',
			'isobath line-opacity',
			'isobath line-width',
			'isobath-label filter'
		]);
	});

	it('writes nothing at all when nothing about the isobaths moved', () => {
		expect(pushes(options(), options({ groundLayer: 'substrate' }))).toEqual([]);
	});

	it('writes every property when there is no baseline to compare against', () => {
		const written: string[] = [];
		const writer: LayerWriter = {
			filter: (id) => written.push(`${id} filter`),
			paint: (id, property) => written.push(`${id} ${property}`),
			layout: (id, property) => written.push(`${id} ${property}`)
		};
		applyIsobathLayers(writer, buildStyle(options()), undefined);
		expect(written.filter((at) => at.endsWith('filter'))).toHaveLength(6);
		expect(written.some((at) => at === 'isobath line-color')).toBe(true);
		expect(written.some((at) => at === 'isobath-label visibility')).toBe(true);
	});
});
