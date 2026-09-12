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

	/** Nested contours tightening toward a summit. */
	isobath: {
		d: [
			'M2.5 17c3-3.5 5.5-5 9.5-5s6.5 1.5 9.5 5',
			'M5.5 13.5c2-2.3 3.9-3.4 6.5-3.4s4.5 1.1 6.5 3.4',
			'M8.5 10.2c1.2-1.3 2.2-1.9 3.5-1.9s2.3.6 3.5 1.9'
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

	language: { d: ['M3 12h18', 'M12 3a15 15 0 0 1 0 18', 'M12 3a15 15 0 0 0 0 18', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'] },

	close: { d: ['M6 6l12 12', 'M18 6 6 18'] },

	chevron: { d: ['M9 5l7 7-7 7'] }
} as const satisfies Record<string, Icon>;

export type IconName = keyof typeof ICONS;
