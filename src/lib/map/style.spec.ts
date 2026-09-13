import { describe, expect, it } from 'vitest';
import { type StyleOptions, buildStyle } from './style.ts';
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
	it('leaves the seabed at full paint when the photograph is off', () => {
		expect(groundStops(options())).toEqual([0.55, 0.92]);
	});

	it('steps the seabed back further at every step up in photo strength', () => {
		const at = (photoStrength: 0.25 | 0.5 | 0.75 | 1) =>
			groundStops(options({ visible: withPhoto(DEFAULT_LAYERS), photoStrength }))[1] ?? 0;
		// Each step has to move, or it is a button that does nothing on a boat.
		expect(at(0.25)).toBeGreaterThan(at(0.5));
		expect(at(0.5)).toBeGreaterThan(at(0.75));
		expect(at(0.75)).toBeGreaterThan(at(1));
		expect(at(1)).toBeLessThan(0.3);
	});

	it('carries the strength to the raster as well as the paint', () => {
		const visible = withPhoto(DEFAULT_LAYERS);
		expect(paintOf(options({ visible, photoStrength: 0.25 }), 'satellite')['raster-opacity']).toBe(
			0.25
		);
	});

	it('does not fade the land, whose two fills would band along their overlap', () => {
		const visible = withPhoto(DEFAULT_LAYERS);
		expect(paintOf(options({ visible, photoStrength: 1 }), 'land')['fill-opacity']).toBeUndefined();
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
