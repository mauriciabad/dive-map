export const CHUNK_SIZE = 65536;

export interface StoredChunk {
	/** Pinned to ArrayBuffer, not ArrayBufferLike, so the bytes can be a Response body directly. */
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly total: number;
	readonly etag: string | null;
}

export interface ChunkStore {
	get(key: string): Promise<StoredChunk | null>;
	put(key: string, chunk: StoredChunk): Promise<void>;
	/** Forget every chunk of one archive, used when the deployed file changes underneath. */
	dropUrl?(url: string): Promise<void>;
}

export interface RangeReaderOptions {
	readonly store: ChunkStore;
	readonly fetch: typeof globalThis.fetch;
	readonly chunkSize?: number | undefined;
	readonly onChunkStored?: ((bytes: number) => void) | undefined;
}

export interface RangeReadOptions {
	readonly etag?: string | undefined;
	readonly signal?: AbortSignal | undefined;
}

export interface RangeRead {
	readonly data: ArrayBuffer;
	readonly etag: string | null;
	readonly total: number;
	/** True when every byte came from the store and nothing touched the network. */
	readonly fromCache: boolean;
}

export interface RangeReader {
	read(url: string, offset: number, length: number, options?: RangeReadOptions): Promise<RangeRead>;
	readonly chunkSize: number;
}

export function chunkKey(url: string, index: number, chunkSize: number): string {
	const key = new URL(url);
	key.searchParams.set('__chunk', `${chunkSize}:${index}`);
	return key.toString();
}

function parseContentRangeTotal(header: string | null): number | null {
	if (header === null) return null;
	const total = /\/(\d+)\s*$/.exec(header)?.[1];
	return total === undefined ? null : Number(total);
}

export function createRangeReader(options: RangeReaderOptions): RangeReader {
	const chunkSize = options.chunkSize ?? CHUNK_SIZE;
	const { store, fetch: doFetch, onChunkStored } = options;

	async function fetchChunk(
		url: string,
		index: number,
		signal: AbortSignal | undefined
	): Promise<StoredChunk> {
		const start = index * chunkSize;
		const headers = new Headers({ Range: `bytes=${start}-${start + chunkSize - 1}` });
		const response = await doFetch(url, signal === undefined ? { headers } : { headers, signal });
		const etag = response.headers.get('ETag');

		if (response.status === 206) {
			const bytes = new Uint8Array(await response.arrayBuffer());
			const total = parseContentRangeTotal(response.headers.get('Content-Range'));
			return { bytes, total: total ?? start + bytes.length, etag };
		}
		if (response.status === 200) {
			// A server that ignores Range sends the whole body, so cut our window out of it.
			const whole = new Uint8Array(await response.arrayBuffer());
			return { bytes: whole.slice(start, start + chunkSize), total: whole.length, etag };
		}
		throw new Error(`Range request for ${url} failed with status ${response.status}`);
	}

	function usableChunk(
		stored: StoredChunk | null,
		expected: string | undefined
	): StoredChunk | null {
		if (stored === null) return null;
		if (expected === undefined || stored.etag === null) return stored;
		return stored.etag === expected ? stored : null;
	}

	async function read(
		url: string,
		offset: number,
		length: number,
		readOptions?: RangeReadOptions,
		retried = false
	): Promise<RangeRead> {
		const signal = readOptions?.signal;
		const first = Math.floor(offset / chunkSize);
		const last = Math.floor((offset + Math.max(1, length) - 1) / chunkSize);
		const parts: Uint8Array[] = [];
		let fromCache = true;
		let etag: string | null = null;
		let total = Number.POSITIVE_INFINITY;

		for (let index = first; index <= last && index * chunkSize < total; index++) {
			signal?.throwIfAborted();
			const key = chunkKey(url, index, chunkSize);
			let chunk = usableChunk(await store.get(key), readOptions?.etag);
			if (chunk === null) {
				chunk = await fetchChunk(url, index, signal);
				fromCache = false;
				await store.put(key, chunk);
				onChunkStored?.(chunk.bytes.length);
			}
			/*
			 * Two chunks of one read disagreeing on the ETag means the file was
			 * redeployed between them. Handing that mixture to pmtiles gets the read
			 * rejected and the app refuses to start, so throw the whole archive's
			 * cache away and read it again from the network.
			 */
			if (etag !== null && chunk.etag !== null && chunk.etag !== etag) {
				await store.dropUrl?.(url);
				if (retried) throw new Error(`archive changed twice while reading ${url}`);
				return read(url, offset, length, { ...readOptions, etag: chunk.etag }, true);
			}
			total = chunk.total;
			etag = chunk.etag;
			parts.push(chunk.bytes);
			if (chunk.bytes.length < chunkSize) break;
		}

		const start = offset - first * chunkSize;
		const available = parts.reduce((sum, part) => sum + part.length, 0);
		const size = Math.max(0, Math.min(length, available - start));
		const data = new ArrayBuffer(size);
		const out = new Uint8Array(data);

		let cursor = 0;
		let written = 0;
		for (const part of parts) {
			const from = Math.max(0, start - cursor);
			if (from < part.length && written < size) {
				const slice = part.subarray(from, from + (size - written));
				out.set(slice, written);
				written += slice.length;
			}
			cursor += part.length;
		}

		return { data, etag, total: Number.isFinite(total) ? total : size, fromCache };
	}

	return { chunkSize, read };
}

/**
 * The Cache API refuses to store a 206 Partial Content response, so nothing a range request returns
 * can be handed to `cache.put` as it stands. Chunks are stored instead as ordinary 200 responses
 * under a synthesised key carrying the chunk size and index, and reads reassemble them.
 *
 * Scope 'origin' searches every cache, so a chunk pinned by a saved area also serves an ordinary map
 * pan. Scope 'cache' searches only this one, which keeps each area's cache self-contained: evicting
 * an area is then a single `caches.delete` that cannot strand another area mid-archive.
 */
export function cacheStorageChunkStore(
	cacheName: string,
	scope: 'origin' | 'cache' = 'origin'
): ChunkStore {
	const opened = caches.open(cacheName);
	return {
		async get(key: string): Promise<StoredChunk | null> {
			const response =
				scope === 'origin' ? await caches.match(key) : await (await opened).match(key);
			if (response === undefined) return null;
			const total = Number(response.headers.get('X-Chunk-Total'));
			if (!Number.isFinite(total)) return null;
			return {
				bytes: new Uint8Array(await response.arrayBuffer()),
				total,
				etag: response.headers.get('X-Chunk-Etag')
			};
		},
		async put(key: string, chunk: StoredChunk): Promise<void> {
			const headers = new Headers({
				'Content-Type': 'application/octet-stream',
				'X-Chunk-Total': String(chunk.total)
			});
			if (chunk.etag !== null) headers.set('X-Chunk-Etag', chunk.etag);
			const cache = await opened;
			await cache.put(key, new Response(chunk.bytes, { status: 200, headers }));
		},
		async dropUrl(url: string): Promise<void> {
			const cache = await opened;
			const target = new URL(url);
			target.searchParams.delete('__chunk');
			const wanted = target.toString();
			const stale = (await cache.keys()).filter((request) => {
				const seen = new URL(request.url);
				seen.searchParams.delete('__chunk');
				return seen.toString() === wanted;
			});
			await Promise.all(stale.map((request) => cache.delete(request)));
		}
	};
}

export function memoryChunkStore(): ChunkStore {
	const entries = new Map<string, StoredChunk>();
	return {
		get: (key) => Promise.resolve(entries.get(key) ?? null),
		put: (key, chunk) => {
			entries.set(key, chunk);
			return Promise.resolve();
		}
	};
}

/** Build the 206 a range request expects out of chunks the Cache API was willing to hold. */
export function rangeResponse(read: RangeRead, offset: number): Response {
	const size = read.data.byteLength;
	const headers = new Headers({
		'Content-Type': 'application/octet-stream',
		'Content-Length': String(size),
		'Accept-Ranges': 'bytes',
		'Content-Range': `bytes ${offset}-${offset + Math.max(0, size - 1)}/${read.total}`
	});
	if (read.etag !== null) headers.set('ETag', read.etag);
	return new Response(read.data, { status: 206, statusText: 'Partial Content', headers });
}

/** Open-ended ranges return null: chunking them would pull the whole archive. */
export function parseRangeHeader(header: string | null): { offset: number; length: number } | null {
	if (header === null) return null;
	const match = /^bytes=(\d+)-(\d+)$/.exec(header.trim());
	if (match === null) return null;
	const [, startText, endText] = match;
	if (startText === undefined || endText === undefined) return null;
	const offset = Number(startText);
	return { offset, length: Number(endText) - offset + 1 };
}
