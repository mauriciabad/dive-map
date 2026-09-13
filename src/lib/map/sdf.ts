/**
 * Turn a coverage mask into the signed distance field MapLibre's symbol shader
 * expects, so one drawing can be tinted per kind and outlined by the style
 * instead of shipping a coloured bitmap per kind.
 *
 * The encoding is not a free choice. MapLibre's `symbolSDF` fragment shader reads
 * the alpha channel and hardcodes two constants: the glyph edge sits at
 * `(256 - 64) / 256`, and the halo edge at `(6 - haloWidth / iconSize) / 8`. So
 * alpha 191 has to mean distance zero, and one eighth of the remaining range has
 * to be one pixel of the image. That is exactly `RADIUS = 8`, `CUTOFF = 0.25`,
 * and it is why `haloWidth` past 6 draws nothing at all.
 *
 * Get it wrong in either direction and nothing errors: the icons just come out
 * fat, hollow, or invisible.
 */

/** Pixels of distance the field can carry. Fixed by `SDF_PX` in MapLibre's shader. */
export const SDF_RADIUS = 8;

/** Where the edge lands in the encoded range. Fixed by the shader's inner edge. */
export const SDF_CUTOFF = 0.25;

/**
 * Felzenszwalb and Huttenlocher's exact distance transform, one row or column at
 * a time. Squared distances throughout: the parabola intersections are exact in
 * that space, and the square root is taken once at the end.
 */
const transform1d = (
	f: Float64Array,
	length: number,
	d: Float64Array,
	vertex: Int32Array,
	edge: Float64Array
): void => {
	vertex[0] = 0;
	edge[0] = -Infinity;
	edge[1] = Infinity;
	let k = 0;
	for (let q = 1; q < length; q++) {
		let s: number;
		do {
			const v = vertex[k] ?? 0;
			s = ((f[q] ?? 0) + q * q - ((f[v] ?? 0) + v * v)) / (2 * q - 2 * v);
			if (s > (edge[k] ?? -Infinity)) break;
			k--;
		} while (k >= 0);
		k++;
		vertex[k] = q;
		edge[k] = s;
		edge[k + 1] = Infinity;
	}
	k = 0;
	for (let q = 0; q < length; q++) {
		while ((edge[k + 1] ?? Infinity) < q) k++;
		const v = vertex[k] ?? 0;
		d[q] = (q - v) * (q - v) + (f[v] ?? 0);
	}
};

const transform2d = (grid: Float64Array, width: number, height: number): void => {
	const side = Math.max(width, height);
	const f = new Float64Array(side);
	const d = new Float64Array(side);
	const vertex = new Int32Array(side);
	const edge = new Float64Array(side + 1);

	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) f[y] = grid[y * width + x] ?? 0;
		transform1d(f, height, d, vertex, edge);
		for (let y = 0; y < height; y++) grid[y * width + x] = d[y] ?? 0;
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) f[x] = grid[y * width + x] ?? 0;
		transform1d(f, width, d, vertex, edge);
		for (let x = 0; x < width; x++) grid[y * width + x] = d[x] ?? 0;
	}
};

/**
 * Coverage in 0..1 per pixel becomes RGBA bytes whose alpha is the field.
 *
 * RGB is left white because only alpha is read. A pixel deeper inside the shape
 * than `radius` saturates at 255 and one further outside than `radius * (1 -
 * cutoff)` bottoms out at 0, so an image needs at least six pixels of clear
 * margin or its halo is cut off at the edge of the tile.
 */
export const distanceField = (
	coverage: Float64Array,
	width: number,
	height: number,
	radius = SDF_RADIUS,
	cutoff = SDF_CUTOFF
): Uint8ClampedArray => {
	const outer = new Float64Array(width * height);
	const inner = new Float64Array(width * height);
	for (let i = 0; i < coverage.length; i++) {
		const a = coverage[i] ?? 0;
		if (a >= 1) {
			outer[i] = 0;
			inner[i] = Infinity;
		} else if (a <= 0) {
			outer[i] = Infinity;
			inner[i] = 0;
		} else {
			// How far this pixel's centre sits from the edge that partly covers it.
			// Seeding both grids with it is what keeps a 2.2 unit stroke smooth
			// rather than stepped once the shader antialiases the field.
			const out = Math.max(0, 0.5 - a);
			const inn = Math.max(0, a - 0.5);
			outer[i] = out * out;
			inner[i] = inn * inn;
		}
	}
	transform2d(outer, width, height);
	transform2d(inner, width, height);

	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const signed = Math.sqrt(outer[i] ?? 0) - Math.sqrt(inner[i] ?? 0);
		data[i * 4] = 255;
		data[i * 4 + 1] = 255;
		data[i * 4 + 2] = 255;
		data[i * 4 + 3] = Math.round(255 - 255 * (signed / radius + cutoff));
	}
	return data;
};
