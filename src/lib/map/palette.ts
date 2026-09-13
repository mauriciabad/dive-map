export const PALETTE = {
	// Deep water, matched to what the veil composites to at 90m so a gap in the
	// survey reads as open sea rather than a hole in the map.
	void: '#03293b',
	shallow: '#2ad9b4',
	deepVeil: '#003850',
	terrainEdge: '#2a2119',
	terrainEdgeSoft: 'rgba(42, 33, 25, 0.55)',
	isobath: '#3d3227',
	isobathMajor: '#241c14',
	land: '#2e2b26',
	landTexture: '#3a3630',
	landEdge: '#585049',

	// Fresh water inland. Slate, and deliberately no member of the sea's teal
	// family, which is the second thing this got wrong. The first attempt used the
	// void colour and a lake came out as a black gash; the second borrowed the
	// shallow teal, and an irrigation canal across the Baix Ter then read as the
	// same substance as shallow sea while being the brightest thing on the sheet.
	// A diver reading a dive map must never mistake a ditch for water they could
	// be in. So inland water is a cool grey-blue at 1.2:1 against the land, present
	// by hue rather than by brightness, with a rim at 2.1:1 to give it a shape.
	landWaterFill: '#2b3a40',
	landWater: '#4d5f62',
	landMarsh: '#2f3f34',
	landMarshEdge: '#48584a',

	// One ink for every road, path and track, warm so it belongs to the wood and
	// brass the table is made of and can never be confused with water. 2.75:1 on
	// the land fill at full strength, and the six classes are told apart by weight
	// and by whether the line is broken, which is how a drawn chart does it and
	// what keeps a town of residential streets from becoming a bright mat. Well
	// under the sunlit sand of the shallows, which has to stay the brightest thing
	// in any frame.
	landInk: '#7d6b50',

	// The one thing on land allowed to be brighter than the ink, because it is the
	// one thing on land a diver is going to walk on. Composited with the sand
	// texture over it this lands near 120 against the land's 73, and still well
	// under the 190 of the same sand lit through two metres of water.
	landSand: '#5c4e38',
	ink: '#1d1710',
	paper: '#efe4cf',
	brass: '#b8893f',
	buoy: '#e0a32e',
	hazard: '#b23a2c'
} as const;
