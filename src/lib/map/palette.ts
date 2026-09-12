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
	ink: '#1d1710',
	paper: '#efe4cf',
	brass: '#b8893f',
	buoy: '#e0a32e',
	hazard: '#b23a2c'
} as const;
