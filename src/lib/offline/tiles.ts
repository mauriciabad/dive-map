export interface Bounds {
	readonly west: number;
	readonly south: number;
	readonly east: number;
	readonly north: number;
}

export interface ZoomRange {
	readonly min: number;
	readonly max: number;
}

export interface TileCoord {
	readonly z: number;
	readonly x: number;
	readonly y: number;
}

const MAX_LATITUDE = 85.0511287798;

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function lonToTileX(lon: number, z: number): number {
	return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
	const rad = (clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function tilesInBounds(bounds: Bounds, zoom: ZoomRange): TileCoord[] {
	const tiles: TileCoord[] = [];
	const west = Math.min(bounds.west, bounds.east);
	const east = Math.max(bounds.west, bounds.east);
	const south = Math.min(bounds.south, bounds.north);
	const north = Math.max(bounds.south, bounds.north);

	for (let z = Math.max(0, Math.floor(zoom.min)); z <= Math.floor(zoom.max); z++) {
		const span = 2 ** z;
		const minX = clamp(Math.floor(lonToTileX(west, z)), 0, span - 1);
		const maxX = clamp(Math.floor(lonToTileX(east, z)), 0, span - 1);
		const minY = clamp(Math.floor(latToTileY(north, z)), 0, span - 1);
		const maxY = clamp(Math.floor(latToTileY(south, z)), 0, span - 1);
		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				tiles.push({ z, x, y });
			}
		}
	}
	return tiles;
}

export function countTilesInBounds(bounds: Bounds, zoom: ZoomRange): number {
	return tilesInBounds(bounds, zoom).length;
}
