import { describe, expect, it } from 'vitest';
import { DEFAULT_ISOBATHS, type IsobathStyle } from './card.ts';
import {
	type PaintMethod,
	contourColour,
	contourDepths,
	defaultColour,
	depthMarks,
	intervalAt,
	paintedBands,
	parseIsobathPaint,
	withColour,
	withEdgeOwnColour,
	withEmphasis,
	withMark,
	withMarkAt,
	withMethod,
	withoutMark
} from './isobaths.ts';

/** The wireframe's own ruler: marks at both ends of the range and five between. */
const wireframe = (method: PaintMethod): IsobathStyle => {
	const depths = [0, 5, 18, 30, 40, 50, 65, 80];
	const painted = depths.reduce(
		(style, depth, index) =>
			withColour(style, depth, ['#aa0000', '#00aa00'][index % 2] ?? '#000000'),
		withMethod({ ...DEFAULT_ISOBATHS, emphasised: depths, maxDepthM: 80 }, method)
	);
	return painted;
};

const colourAt = (style: IsobathStyle, depthM: number): string =>
	contourColour(paintedBands(style), depthM);

describe('painted bands', () => {
	it('paints a band upwards from its deepest line', () => {
		const style = wireframe('upwards');
		// The lines between 5 and 18 take 18's colour, and 18 itself is in its band.
		expect(colourAt(style, 6)).toBe(colourAt(style, 18));
		expect(colourAt(style, 17)).toBe(colourAt(style, 18));
		expect(colourAt(style, 5)).not.toBe(colourAt(style, 18));
	});

	it('paints a band downwards from its shallowest line', () => {
		const style = wireframe('downwards');
		expect(colourAt(style, 6)).toBe(colourAt(style, 5));
		expect(colourAt(style, 17)).toBe(colourAt(style, 5));
		expect(colourAt(style, 18)).not.toBe(colourAt(style, 5));
	});

	it('leaves the water no mark governs on the depth ramp', () => {
		const shallow = { ...DEFAULT_ISOBATHS, emphasised: [30], maxDepthM: 80 };
		// Upwards, nothing reaches down past 30 m.
		expect(paintedBands(shallow).at(-1)).toEqual({ fromM: 31, toM: 80, colour: undefined });
		// Downwards, nothing reaches up past it.
		expect(paintedBands(withMethod(shallow, 'downwards'))[0]).toEqual({
			fromM: 0,
			toM: 29,
			colour: undefined
		});
	});

	it('covers every metre of the range exactly once', () => {
		for (const method of ['upwards', 'downwards'] as const) {
			const bands = paintedBands(wireframe(method));
			expect(bands[0]?.fromM).toBe(0);
			expect(bands.at(-1)?.toM).toBe(80);
			for (const [index, band] of bands.entries()) {
				expect(band.fromM).toBeLessThanOrEqual(band.toM);
				if (index > 0) expect(band.fromM).toBe((bands[index - 1]?.toM ?? 0) + 1);
			}
		}
	});
});

describe('the line no band reaches', () => {
	it('is the 0 m contour painting upwards', () => {
		const marks = depthMarks(wireframe('upwards'));
		expect(marks.filter((mark) => mark.noBand).map((mark) => mark.depthM)).toEqual([0]);
	});

	it('is the deepest contour painting downwards, when it sits on the maximum', () => {
		const marks = depthMarks(wireframe('downwards'));
		expect(marks.filter((mark) => mark.noBand).map((mark) => mark.depthM)).toEqual([80]);
	});

	it('is nobody when the deepest mark still has water under it', () => {
		const style = { ...wireframe('downwards'), maxDepthM: 90 };
		expect(depthMarks(style).some((mark) => mark.noBand)).toBe(false);
		expect(colourAt(style, 85)).toBe(colourAt(style, 80));
	});

	it('keeps its own colour, or follows the band beside it', () => {
		const own = wireframe('downwards');
		expect(colourAt(own, 80)).not.toBe(colourAt(own, 79));
		const shared = withEdgeOwnColour(own, false);
		expect(colourAt(shared, 80)).toBe(colourAt(shared, 79));

		const up = wireframe('upwards');
		expect(colourAt(up, 0)).not.toBe(colourAt(up, 1));
		expect(colourAt(withEdgeOwnColour(up, false), 0)).toBe(colourAt(up, 1));
	});
});

describe('switching which line names a band', () => {
	it('ships painting upwards, in the colours the depth ramp has always given', () => {
		// [0, 5] is the shallow gold band and (5, 18] the green one, which is what
		// the map drew before any of this was a diver's to change.
		expect(colourAt(DEFAULT_ISOBATHS, 0)).toBe(defaultColour(4));
		expect(colourAt(DEFAULT_ISOBATHS, 4)).toBe(defaultColour(4));
		expect(colourAt(DEFAULT_ISOBATHS, 6)).toBe(defaultColour(17));
		expect(colourAt(DEFAULT_ISOBATHS, 18)).toBe(defaultColour(17));
	});

	/**
	 * The contours between the marks, which is what a diver is looking at. A marked
	 * line itself belongs to the band above it going upwards and the band below it
	 * going downwards, so that one line changes colour by definition of the switch.
	 */
	it('leaves the water between two marks looking the same either way', () => {
		const downwards = withMethod(DEFAULT_ISOBATHS, 'downwards');
		for (const depth of [6, 10, 17, 19, 25, 29, 31, 39, 41, 49]) {
			expect(colourAt(downwards, depth)).toBe(colourAt(DEFAULT_ISOBATHS, depth));
		}
	});

	it('moves a painted colour to the mark that now governs its band', () => {
		const painted = withColour(withColour(DEFAULT_ISOBATHS, 18, '#112233'), 30, '#445566');
		const downwards = withMethod(painted, 'downwards');
		// The same water, the same two colours, one mark further up the ruler.
		for (const depth of [6, 10, 17, 19, 25, 29]) {
			expect(colourAt(downwards, depth)).toBe(colourAt(painted, depth));
		}
		expect(depthMarks(downwards).find((mark) => mark.depthM === 5)?.colour).toBe('#112233');
		expect(depthMarks(downwards).find((mark) => mark.depthM === 18)?.colour).toBe('#445566');
	});

	it('leaves the weight of a line where the line is', () => {
		const thin = withEmphasis(DEFAULT_ISOBATHS, 30, false);
		const marks = depthMarks(withMethod(thin, 'downwards'));
		expect(marks.filter((mark) => !mark.emphasised).map((mark) => mark.depthM)).toEqual([30]);
	});
});

describe('marks', () => {
	it('starts a new mark on its own depth band', () => {
		const style = withMark(DEFAULT_ISOBATHS, 65);
		expect(style.emphasised).toEqual([5, 18, 30, 40, 50, 65]);
		expect(depthMarks(style).find((mark) => mark.depthM === 65)?.colour).toBe(defaultColour(65));
	});

	it('drops the weight without dropping the colour', () => {
		const style = withEmphasis(withColour(DEFAULT_ISOBATHS, 18, '#123456'), 18, false);
		const mark = depthMarks(style).find((m) => m.depthM === 18);
		expect(mark).toEqual({ depthM: 18, colour: '#123456', emphasised: false, noBand: false });
		// Upwards, 18 m governs the water above it, up to the mark at 5 m.
		expect(colourAt(style, 10)).toBe('#123456');
	});

	it('carries the colour to a depth a mark is moved to', () => {
		const moved = withMarkAt(withColour(DEFAULT_ISOBATHS, 18, '#123456'), 18, 22);
		expect(moved.emphasised).toEqual([5, 22, 30, 40, 50]);
		expect(depthMarks(moved).find((mark) => mark.depthM === 22)?.colour).toBe('#123456');
	});

	it('refuses to move a mark onto one that is already there', () => {
		expect(withMarkAt(DEFAULT_ISOBATHS, 18, 30)).toBe(DEFAULT_ISOBATHS);
	});

	it('gives a depth put back the colour it had', () => {
		const painted = withColour(DEFAULT_ISOBATHS, 30, '#abcdef');
		expect(
			depthMarks(withMark(withoutMark(painted, 30), 30)).find((m) => m.depthM === 30)?.colour
		).toBe('#abcdef');
	});
});

describe('the contours a ruler has to draw', () => {
	it('follows the zoom while the interval is automatic', () => {
		expect(intervalAt(DEFAULT_ISOBATHS, 10)).toBe(20);
		expect(intervalAt(DEFAULT_ISOBATHS, 14.5)).toBe(5);
		expect(intervalAt(DEFAULT_ISOBATHS, 17)).toBe(1);
		expect(intervalAt({ ...DEFAULT_ISOBATHS, autoInterval: false, intervalM: 2 }, 17)).toBe(2);
	});

	it('draws the marked depths whatever the interval says', () => {
		const depths = contourDepths({ ...DEFAULT_ISOBATHS, autoInterval: false, intervalM: 20 }, 14);
		expect(depths).toContain(18);
		expect(depths).toContain(40);
		expect(depths).toContain(60);
	});

	it('leaves the shoreline out until somebody marks it', () => {
		const plain = { ...DEFAULT_ISOBATHS, autoInterval: false, intervalM: 5 };
		expect(contourDepths(plain, 14)).not.toContain(0);
		expect(contourDepths(withMark(plain, 0), 14)).toContain(0);
	});
});

describe('reading back what the ruler wrote', () => {
	it('keeps a blob without paint on the map original behaviour', () => {
		expect(parseIsobathPaint(undefined)).toEqual({});
		expect(parseIsobathPaint('upwards')).toEqual({});
	});

	it('drops a colour it cannot paint and a depth it cannot mark', () => {
		const read = parseIsobathPaint({
			method: 'upwards',
			marks: {
				5: { colour: 'red' },
				18: { colour: '#00ff00', plain: true },
				'-2': { colour: '#fff000' }
			},
			edgeOwnColour: false
		});
		expect(read.paint?.marks).toEqual({ 18: { colour: '#00ff00', plain: true } });
		expect(read.paint?.method).toBe('upwards');
		expect(read.paint?.edgeOwnColour).toBe(false);
	});

	it('reads a method it does not know as the one the map has always used', () => {
		expect(parseIsobathPaint({ method: 'sideways' }).paint?.method).toBe('downwards');
	});
});
