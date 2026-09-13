/**
 * Authored icons, drawn in one stroke weight to match the painted world: chunky,
 * rounded, slightly informal. A 24x24 box, solid where a shape needs mass.
 *
 * Drawn rather than borrowed because the set is small and specific. No icon
 * library has an isobath.
 */

export interface Icon {
	/** Stroked outlines. */
	readonly d: readonly string[];
	/**
	 * Solid shapes, stroked in the same weight so they read as one drawing. Mass
	 * is what survives at marker size: a hull or a rock made of hairlines
	 * disappears against a painted seabed at 20 px.
	 */
	readonly fill?: readonly string[];
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

	/**
	 * Bands closing up as they descend to a solid floor: darker with depth. The
	 * sounding arrow this replaces is the isobath labels' own icon, so the two
	 * switches said the same thing and neither said depth veil.
	 */
	depthVeil: { d: ['M3 5h18', 'M3 9.5h18', 'M3 13h18', 'M3 15.8h18'], fill: ['M3 18h18v3H3z'] },

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

	/** A pencil, for annotations. */
	annotate: { d: ['M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z', 'M14.5 6.5l3 3'] },

	/** A framed sheet, for print. */
	print: { d: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h3'] },

	/** Two swatches, each with its line of caption: the legend. */
	legend: { d: ['M4 5h6v6H4z', 'M14 8h6', 'M4 14h6v6H4z', 'M14 17h6'] },

	/** Crop corners, for the framing overlay. */
	frame: { d: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'] },

	/** A photograph of ground: a headland under a sun, in a frame. */
	satellite: {
		d: ['M3 5h18v14H3z', 'M6 16.2l4.2-5.2 3 3.6 2.2-2.6 2.6 4.2'],
		dots: [[8.2, 8.6, 1.5]]
	},

	/** Two crests and a trough: the wave marks an old chart scatters over open water. */
	flourish: { d: ['M3 9q3-3 5 0t5 0 5 0 3 0', 'M3 15q3-3 5 0t5 0 5 0 3 0'] },

	language: {
		d: [
			'M3 12h18',
			'M12 3a15 15 0 0 1 0 18',
			'M12 3a15 15 0 0 0 0 18',
			'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'
		]
	},

	/**
	 * An arrow all the way round to where it started. The bracket at the top left
	 * is the arrowhead and the end of the stroke at once, which is what keeps a
	 * head from closing up against the arc at 18 px.
	 */
	reset: { d: ['M2.8 5v4.9h4.9', 'M5 14.8a7.6 7.6 0 1 0 1.8-7.9L2.8 9.9'] },

	/**
	 * A luggage tag with its hole punched: a setting-up of the map with a name on
	 * it. The hole is a solid dot rather than a ring because at 22 px a stroked
	 * circle of that size closes up into one anyway.
	 */
	tag: {
		d: ['M11 4h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7L4 12z'],
		dots: [[9.4, 12, 1.35]]
	},

	close: { d: ['M6 6l12 12', 'M18 6 6 18'] },

	chevron: { d: ['M9 5l7 7-7 7'] },

	plus: { d: ['M12 5v14', 'M5 12h14'] },

	/**
	 * Three rails, the grip on the side of a thing that moves. Drawn as the ruler's
	 * own lines so that what a diver grabs looks like what they are grabbing.
	 */
	grip: { d: ['M5 8.5h14', 'M5 12h14', 'M5 15.5h14'] },

	/** A bin with its lid proud of the body, which is what reads at 18 px. */
	trash: {
		d: ['M4.5 6.5h15', 'M9.5 6.5V4h5v2.5', 'M10 11v6', 'M14 11v6'],
		fill: ['M6.4 8.5h11.2l-1 11.5H7.4z']
	},

	/**
	 * Paint running up to the surface and down to the next line. The bar is the
	 * contour the paint stops at, so the pair say which line a band belongs to
	 * rather than merely which way is up.
	 */
	paintUp: { d: ['M4 4h16', 'M12 20V8', 'M7.5 12.5 12 8l4.5 4.5'] },

	paintDown: { d: ['M4 20h16', 'M12 4v12', 'M7.5 11.5 12 16l4.5-4.5'] },

	/*
	 * Map marks, from here down. Same box and same stroke as the panel icons
	 * above, drawn heavier because they are read at about 20 px over a painted
	 * seabed rather than at 24 px on flat wood. Each one is a chart object seen
	 * from the side, not a pin: a diver should tell a wreck from a mooring buoy
	 * without reading the label.
	 */

	/** The plate a marker sits on. Only the dive site earns one; see markers.ts. */
	markerDisc: { d: [], fill: ['M12 1.8a10.2 10.2 0 1 0 0 20.4 10.2 10.2 0 0 0 0-20.4'] },

	/**
	 * The diver-down flag, which is the one mark every boat on this coast already
	 * reads. The staff and the outline are the drawing; the two triangles either
	 * side of the diagonal band are gaps, so the red plate underneath shows through
	 * them and the flag comes out red with a white stripe across it.
	 */
	markerDiveSite: {
		d: ['M5.8 4.4v15.2', 'M5.8 6.2h11.8v7.8H5.8z'],
		fill: ['M5.8 6.2h3.5l8.3 7.8h-3.5z']
	},

	/** A hull gone over with its mast still up, the chart's own way of saying wreck. */
	markerWreck: {
		d: ['M8.2 11.6 4.6 4.4', 'M3 6.6 7.8 5.2'],
		fill: ['M2.6 12.6 19.8 8.4 18 14.6Q10.6 20 4.4 16.4z']
	},

	/** A buoy on its riser, down to the block on the bottom. */
	markerMooring: {
		d: ['M12 11.8v6.4', 'M7.4 20.4h9.2'],
		dots: [[12, 7.6, 4.2]]
	},

	/** A peak with the sea closing over it. */
	markerRock: {
		d: ['M2.4 4.6q2.9-2.2 5.8 0t5.8 0 5.8 0'],
		fill: ['M2.6 21 8.6 12.6 11.9 16.6 15.4 11 21.4 21z']
	},

	/** The one mark that has to mean stop without being read. */
	markerRestricted: {
		d: ['M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2', 'M6 6 18 18']
	},

	/**
	 * Somebody swimming at the surface, which is what a bathing zone is. The same
	 * wave the rock and the slipway are drawn against, so the three read as one set.
	 *
	 * Head, torso and arm all touch. Two strokes closer than twice the halo merge
	 * into a blob at marker size, and a swimmer whose head has come off is worse
	 * than no swimmer.
	 */
	markerSwimmer: {
		d: ['M2.4 20.2q2.9-2.2 5.8 0t5.8 0 5.8 0', 'M7.4 13.2h7', 'M8.8 13 12.8 7.2 18.4 10.2'],
		dots: [[6, 12.6, 2.4]]
	},

	/**
	 * A can buoy with the cross topmark that makes it a special mark: the yellow
	 * thing strung around a bathing zone. The mast carries the cross, so the whole
	 * drawing is one connected shape and nothing merges into the can.
	 */
	markerBuoy: {
		d: ['M2.4 20.4q2.9-2.2 5.8 0t5.8 0 5.8 0', 'M12 11V4.4', 'M9.8 4 14.2 8.4', 'M14.2 4 9.8 8.4'],
		fill: ['M8.2 11h7.6l-1.3 6.8H9.5z']
	},

	/** A lamp throwing its beam, which is all a light is to someone on deck. */
	markerLight: {
		d: ['M15.4 5.4 21.6 2.6', 'M16.4 10.4h5.8', 'M15.4 15.4 21.6 18.2'],
		dots: [[9.4, 10.4, 3.8]]
	},

	/** The slope down into the water, with the water at the bottom of it. */
	markerSlipway: {
		d: ['M5.6 4.4 14.2 13', 'M8.8 13.6h6V7.6', 'M2.4 19.4q2.9-2.2 5.8 0t5.8 0 5.8 0']
	},

	/** Rungs on a quay wall. The other way in and out of the water. */
	markerLadder: {
		d: ['M7.8 3.2v17.6', 'M16.2 3.2v17.6', 'M7.8 6.8h8.4', 'M7.8 12h8.4', 'M7.8 17.2h8.4']
	},

	/**
	 * A cylinder with its valve block on top: the rack every dive centre has a wall
	 * of. The block is what stops a bare capsule reading as a bomb.
	 */
	markerDiveCentre: {
		d: ['M8.4 5.4h7.2'],
		fill: ['M8.4 11a3.6 3.6 0 0 1 7.2 0v6a3.6 3.6 0 0 1-7.2 0z', 'M10.2 6.2h3.6v4.2h-3.6z']
	}
} as const satisfies Record<string, Icon>;

export type IconName = keyof typeof ICONS;
