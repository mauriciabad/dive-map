/**
 * The source whose tile failed, or undefined when the failure was not about a tile.
 *
 * This distinction decides whether a map survives. One tile that fails to fetch
 * leaves a hole in a corner of something otherwise finished, and a sheet with a
 * hole that says so beats no sheet at all. Anything that is not a tile, a style
 * that will not parse above all, means nothing is coming.
 *
 * `sourceId` and `tile` are real at runtime and absent from `ErrorEvent`, whose
 * constructor spreads an untyped `data` object onto the instance, so they are
 * narrowed rather than asserted.
 */
export const failedTileSource = (event: object): string | undefined => {
	if (!('sourceId' in event) || !('tile' in event)) return undefined;
	const { sourceId, tile } = event;
	return typeof sourceId === 'string' && typeof tile === 'object' && tile !== null
		? sourceId
		: undefined;
};
