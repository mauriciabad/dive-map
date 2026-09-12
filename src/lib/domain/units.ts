/**
 * The seabed is measured two ways and mixing them is the bug that would hurt most.
 * ICGC rasters store elevation (negative under water). Divers, OSM tags and the
 * printed cards all talk depth (positive under water). Brand both so the compiler
 * refuses the swap, and convert only here.
 */

declare const DepthBrand: unique symbol;
declare const ElevationBrand: unique symbol;

/** Metres below sea level. Always >= 0 for anything underwater. */
export type Depth = number & { readonly [DepthBrand]: true };

/** Metres above sea level, as stored in a DEM. Negative underwater. */
export type Elevation = number & { readonly [ElevationBrand]: true };

export const depth = (m: number): Depth => {
	if (!Number.isFinite(m) || m < 0) throw new RangeError(`depth must be finite and >= 0, got ${m}`);
	return m as Depth;
};

export const elevation = (m: number): Elevation => {
	if (!Number.isFinite(m)) throw new RangeError(`elevation must be finite, got ${m}`);
	return m as Elevation;
};

export const depthOf = (e: Elevation): Depth => depth(Math.max(0, -e));
export const elevationOf = (d: Depth): Elevation => elevation(-d);

/** Denominator of a map scale: 2000 means 1:2000. What a printed card is specified in. */
declare const ScaleBrand: unique symbol;
export type ScaleDenominator = number & { readonly [ScaleBrand]: true };

export const scale = (denominator: number): ScaleDenominator => {
	if (!Number.isFinite(denominator) || denominator <= 0) {
		throw new RangeError(`scale denominator must be > 0, got ${denominator}`);
	}
	return denominator as ScaleDenominator;
};
