import { describe, expect, it } from 'vitest';
import { type StyleOptions, buildStyle } from './style.ts';
import { DEFAULT_ISOBATHS, DEFAULT_LAYERS, type LayerId } from '$lib/domain/card';

const options = (extra: Partial<StyleOptions> = {}): StyleOptions => ({
	locale: 'ca',
	isobaths: DEFAULT_ISOBATHS,
	visible: DEFAULT_LAYERS,
	groundLayer: 'habitats',
	smoothed: true,
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
		if (!Array.isArray(width) || !Array.isArray(line)) throw new Error('widths are not expressions');
		// The thinnest contour at the widest zoom: the casing has to be proud of it.
		const thinnest = (expression: unknown[]): number => {
			const stop = expression[6];
			return Array.isArray(stop) ? (stop[4] as number) : 0;
		};
		expect(thinnest(width)).toBeGreaterThan(thinnest(line));
	});
});
