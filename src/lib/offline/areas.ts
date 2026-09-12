import { PMTiles } from 'pmtiles';
import { AREA_CACHE_PREFIX, MANIFEST_CACHE } from './cache-names.ts';
import { cachedRangeSource } from './pmtiles-source.ts';
import { cacheStorageChunkStore, createRangeReader } from './range-cache.ts';
import { tilesInBounds, type Bounds, type ZoomRange } from './tiles.ts';

declare const areaId: unique symbol;
export type SavedAreaId = string & { readonly [areaId]: true };

export interface SavedArea {
	readonly id: SavedAreaId;
	readonly name: string;
	readonly bounds: Bounds;
	readonly zoom: ZoomRange;
	readonly archives: readonly string[];
	readonly savedAt: number;
	readonly tiles: number;
	readonly bytes: number;
}

export interface SaveAreaRequest {
	readonly name: string;
	readonly bounds: Bounds;
	readonly zoom: ZoomRange;
	readonly archives: readonly string[];
}

export interface SaveProgress {
	readonly done: number;
	readonly total: number;
	readonly bytes: number;
}

export interface SaveAreaOptions {
	readonly onProgress?: ((progress: SaveProgress) => void) | undefined;
	readonly signal?: AbortSignal | undefined;
}

export interface StorageUsage {
	readonly used: number;
	readonly quota: number;
	readonly persisted: boolean;
}

const MANIFEST_KEY = '/__offline/areas.json';

export function areaCacheName(id: SavedAreaId): string {
	return `${AREA_CACHE_PREFIX}${id}`;
}

/** The one cast in this file: the manifest is JSON an older build may have written. */
function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function isBounds(value: unknown): value is Bounds {
	const record = asRecord(value);
	if (record === null) return false;
	return (['west', 'south', 'east', 'north'] as const).every(
		(key) => typeof record[key] === 'number'
	);
}

function isZoomRange(value: unknown): value is ZoomRange {
	const record = asRecord(value);
	if (record === null) return false;
	return typeof record['min'] === 'number' && typeof record['max'] === 'number';
}

function toSavedArea(value: unknown): SavedArea | null {
	const record = asRecord(value);
	if (record === null) return null;
	const { id, name, savedAt, tiles, bytes, archives, bounds, zoom } = record;
	if (typeof id !== 'string' || typeof name !== 'string') return null;
	if (typeof savedAt !== 'number' || typeof tiles !== 'number' || typeof bytes !== 'number') {
		return null;
	}
	if (!Array.isArray(archives)) return null;
	const urls: unknown[] = archives;
	if (!urls.every((url): url is string => typeof url === 'string')) return null;
	if (!isBounds(bounds) || !isZoomRange(zoom)) return null;
	return {
		id: id as SavedAreaId,
		name,
		bounds,
		zoom,
		archives: urls,
		savedAt,
		tiles,
		bytes
	};
}

async function readManifest(): Promise<SavedArea[]> {
	const cache = await caches.open(MANIFEST_CACHE);
	const response = await cache.match(MANIFEST_KEY);
	if (response === undefined) return [];
	const parsed: unknown = await response.json().catch(() => null);
	if (!Array.isArray(parsed)) return [];
	return parsed.map(toSavedArea).filter((area): area is SavedArea => area !== null);
}

async function writeManifest(areas: readonly SavedArea[]): Promise<void> {
	const cache = await caches.open(MANIFEST_CACHE);
	await cache.put(
		MANIFEST_KEY,
		new Response(JSON.stringify(areas), {
			headers: { 'Content-Type': 'application/json' }
		})
	);
}

let manifestQueue: Promise<unknown> = Promise.resolve();

function editManifest<T>(edit: (areas: SavedArea[]) => Promise<T> | T): Promise<T> {
	const next = manifestQueue.then(async () => {
		const areas = await readManifest();
		const result = await edit(areas);
		await writeManifest(areas);
		return result;
	});
	manifestQueue = next.catch(() => undefined);
	return next;
}

export function listAreas(): Promise<SavedArea[]> {
	return readManifest();
}

export async function evictArea(id: SavedAreaId): Promise<void> {
	await caches.delete(areaCacheName(id));
	await editManifest((areas) => {
		const index = areas.findIndex((area) => area.id === id);
		if (index !== -1) areas.splice(index, 1);
	});
}

export async function evictAllAreas(): Promise<void> {
	for (const area of await listAreas()) await evictArea(area.id);
}

/**
 * Pull every byte the given archives need to answer tile lookups inside `bounds` at `zoom`, by
 * reading the tiles through pmtiles so its directory walk decides which ranges matter. Re-running
 * the same request only fills gaps, so an interrupted save resumes by being called again.
 */
export async function saveArea(
	request: SaveAreaRequest,
	options: SaveAreaOptions = {}
): Promise<SavedArea> {
	const id = crypto.randomUUID() as SavedAreaId;
	let bytes = 0;
	const reader = createRangeReader({
		store: cacheStorageChunkStore(areaCacheName(id), 'cache'),
		fetch: globalThis.fetch.bind(globalThis),
		onChunkStored: (stored) => (bytes += stored)
	});

	const tiles = tilesInBounds(request.bounds, request.zoom);
	const total = tiles.length * request.archives.length;
	let done = 0;

	try {
		for (const url of request.archives) {
			const archive = new PMTiles(cachedRangeSource(url, reader));
			const header = await archive.getHeader();
			for (const tile of tiles) {
				options.signal?.throwIfAborted();
				if (tile.z >= header.minZoom && tile.z <= header.maxZoom) {
					await archive.getZxy(tile.z, tile.x, tile.y, options.signal);
				}
				done += 1;
				options.onProgress?.({ done, total, bytes });
			}
		}
	} catch (error) {
		await caches.delete(areaCacheName(id));
		throw error;
	}

	const area: SavedArea = {
		id,
		name: request.name,
		bounds: request.bounds,
		zoom: request.zoom,
		archives: [...request.archives],
		savedAt: Date.now(),
		tiles: tiles.length,
		bytes
	};
	await editManifest((areas) => {
		areas.push(area);
	});
	return area;
}

export async function storageUsage(): Promise<StorageUsage | null> {
	if (!('storage' in navigator)) return null;
	const { usage, quota } = await navigator.storage.estimate();
	return {
		used: usage ?? 0,
		quota: quota ?? 0,
		persisted: await navigator.storage.persisted()
	};
}

/** Without this the browser may evict saved areas under storage pressure, offline and at sea. */
export function requestPersistence(): Promise<boolean> {
	return navigator.storage.persist();
}
