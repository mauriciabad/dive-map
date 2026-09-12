import type { RangeResponse, Source } from 'pmtiles';
import type { RangeReader } from './range-cache.ts';

/**
 * pmtiles reads an archive through this two-method interface, so pointing it at the chunk cache is
 * enough to make every directory and tile lookup survive going offline.
 */
export function cachedRangeSource(url: string, reader: RangeReader): Source {
	return {
		getKey: () => url,
		async getBytes(
			offset: number,
			length: number,
			signal?: AbortSignal,
			etag?: string
		): Promise<RangeResponse> {
			const read = await reader.read(url, offset, length, { etag, signal });
			return read.etag === null ? { data: read.data } : { data: read.data, etag: read.etag };
		}
	};
}
