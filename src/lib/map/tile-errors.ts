/**
 * The source a failure belongs to, or undefined when it belongs to none.
 *
 * Every error a source fires reaches the map with that source's id attached,
 * whether it was one tile that would not fetch or the archive's own header. What
 * is left over names no source at all, and a style that will not parse is the
 * whole of that case: it is the one failure that means nothing is coming.
 *
 * `sourceId` and `tile` are real at runtime and absent from `ErrorEvent`, whose
 * constructor spreads an untyped `data` object onto the instance, so they are
 * narrowed rather than asserted.
 */
export const failedSource = (event: object): string | undefined => {
	if (!('sourceId' in event)) return undefined;
	const { sourceId } = event;
	return typeof sourceId === 'string' ? sourceId : undefined;
};

/**
 * The source whose tile failed, or undefined when the failure was not about a tile.
 *
 * A finer cut than `failedSource`, for the print path. One tile that fails to
 * fetch leaves a hole in a corner of something otherwise finished, and a sheet
 * with a hole that says so beats no sheet at all. An archive that never opened
 * at all is a sheet with nothing on it, and a diver has to be told.
 */
export const failedTileSource = (event: object): string | undefined => {
	if (!('tile' in event)) return undefined;
	const { tile } = event;
	return typeof tile === 'object' && tile !== null ? failedSource(event) : undefined;
};
