/**
 * Authored icons, drawn in one stroke weight to match the painted world: chunky,
 * rounded, slightly informal. A 24x24 box, no fills.
 *
 * Drawn rather than borrowed because the set is small and specific. No icon
 * library has an isobath.
 */

export interface Icon {
	readonly d: readonly string[];
	/** Small solid circles as [cx, cy, r], for grains and soundings. */
	readonly dots?: readonly (readonly [number, number, number])[];
}

export const ICONS = {
	/** Stacked terrain levels, the map's own subject. */
	layers: { d: ['M3 8.5 12 4l9 4.5-9 4.5z', 'M3 13l9 4.5 9-4.5', 'M3 17l9 4.5 9-4.5'] },

	/**
	 * Three closed contours nested inside one another, the way isobaths ring a
	 * shoal on the chart. The previous set of open arcs read as a signal meter.
	 */
	isobath: {
		d: [
			'M12 2.6c5.2 0 9.4 3.8 9.4 8.9 0 5.5-4.3 9.9-9.7 9.9-5.1 0-9.1-3.9-9.1-8.9 0-5.6 4.1-9.9 9.4-9.9z',
			'M11.9 6.4c3.2 0 5.8 2.3 5.8 5.4 0 3.3-2.7 6-6 6-3 0-5.4-2.3-5.4-5.3 0-3.4 2.5-6.1 5.6-6.1z',
			'M11.7 10.3c1.4 0 2.4 1 2.4 2.3 0 1.4-1.1 2.5-2.5 2.5-1.2 0-2.2-1-2.2-2.2 0-1.4 1-2.6 2.3-2.6z'
		]
	},

	/** Seagrass fronds rising off the bottom. */
	habitat: {
		d: [
			'M4 21h16',
			'M8 21c0-4.5-1.2-7.5-3-9.5',
			'M12 21c0-6 .6-9.6 2-12',
			'M16 21c0-4.5 1.2-7.5 3-9.5'
		]
	},

	/** Loose grains over a bedded line. */
	substrate: {
		d: ['M3 16.5h18'],
		dots: [
			[6, 12.6, 1.1],
			[11, 11.4, 1.4],
			[16.4, 12.8, 1.1],
			[5.2, 19.6, 1],
			[10, 20.2, 1.2],
			[15.6, 19.5, 1],
			[19.6, 20.3, 0.9]
		]
	},

	/** Low sun raking a slope: the hillshade. */
	relief: {
		d: ['M2.5 19.5 10 8l4.5 6.5L18 10l3.5 9.5z', 'M5.6 5 4 3.4', 'M9.4 3.2V2', 'M3.6 8.8H2.2']
	},

	/** A sounding line to the bottom. */
	depth: { d: ['M12 3v13', 'M8.5 12.5 12 16l3.5-3.5', 'M4 20h16'] },

	/** A mooring buoy on its line. */
	buoy: { d: ['M12 13v7', 'M8.5 21h7', 'M12 3l3.8 6.5H8.2z'] },

	/** A pencil, for annotations. */
	annotate: { d: ['M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z', 'M14.5 6.5l3 3'] },

	/** A framed sheet, for print. */
	print: { d: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h3'] },

	/** Crop corners, for the framing overlay. */
	frame: { d: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'] },

	language: {
		d: [
			'M3 12h18',
			'M12 3a15 15 0 0 1 0 18',
			'M12 3a15 15 0 0 0 0 18',
			'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'
		]
	},

	close: { d: ['M6 6l12 12', 'M18 6 6 18'] },

	chevron: { d: ['M9 5l7 7-7 7'] }
} as const satisfies Record<string, Icon>;

export type IconName = keyof typeof ICONS;
