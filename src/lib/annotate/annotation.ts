/**
 * What a guide draws on the map before a briefing.
 *
 * The kinds are the four questions a deck briefing answers, in the order they get
 * asked: where do we get in, which way do we swim, what must we stay away from,
 * and where is the thing worth seeing. PRODUCT names the last one as one of the
 * two failures this exists to fix, so it is a kind of its own rather than a note.
 *
 * Colour is not a free choice. It is a function of the kind, because the palette
 * has to survive a dark map at sea and a laminated A3 sheet under glare, and a
 * user picking their own would eventually pick neither.
 */

export type AnnotationKind = 'entry' | 'route' | 'hazard' | 'feature';

export type AnnotationGeometryType = 'Point' | 'LineString' | 'Polygon';

export type Position = readonly [number, number];

export type AnnotationGeometry =
	| { readonly type: 'Point'; readonly coordinates: Position }
	| { readonly type: 'LineString'; readonly coordinates: readonly Position[] }
	| { readonly type: 'Polygon'; readonly coordinates: readonly (readonly Position[])[] };

export interface Annotation {
	readonly id: string;
	readonly kind: AnnotationKind;
	/** Absent rather than empty. The style's label layer filters on `has label`. */
	readonly label: string | undefined;
	readonly geometry: AnnotationGeometry;
}

export interface KindStyle {
	/** Written onto the feature so `annotation-*` can read it. */
	readonly colour: string;
	/** Ordered darkest-last so a mono print still separates them by density. */
	readonly order: number;
}

/**
 * Four hues, all taken from the table palette so annotations look native rather
 * than pasted on. Annotation layers sit above the depth veil, so these are the
 * colours that actually reach the eye, unveiled, at 5 m and at 80 m alike.
 *
 * Entry amber and hazard red are the weakest pair for a red-green reader. They
 * separate by lightness, by geometry in practice, and by the label, which is why
 * the toolbar names the kind in words and never by swatch alone.
 */
export const KINDS: Readonly<Record<AnnotationKind, KindStyle>> = {
	entry: { colour: '#e0a32e', order: 0 },
	route: { colour: '#efe4cf', order: 1 },
	feature: { colour: '#2ad9b4', order: 2 },
	hazard: { colour: '#d4553f', order: 3 }
};

export const KIND_IDS: readonly AnnotationKind[] = ['entry', 'route', 'hazard', 'feature'];

/** Reading an unknown key off a non-null object yields `unknown`, which is the truth. */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null;

const isKind = (value: unknown): value is AnnotationKind =>
	typeof value === 'string' && Object.hasOwn(KINDS, value);

const isPosition = (value: unknown): value is Position =>
	Array.isArray(value) &&
	value.length >= 2 &&
	typeof value[0] === 'number' &&
	typeof value[1] === 'number' &&
	Number.isFinite(value[0]) &&
	Number.isFinite(value[1]);

/** Drops altitude and anything past it, so two writings of the same point compare equal. */
const position = (value: unknown): Position | undefined =>
	isPosition(value) ? [value[0], value[1]] : undefined;

const positions = (value: unknown): readonly Position[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const out: Position[] = [];
	for (const item of value) {
		const p = position(item);
		if (p === undefined) return undefined;
		out.push(p);
	}
	return out;
};

const geometry = (value: unknown): AnnotationGeometry | undefined => {
	if (!isRecord(value)) return undefined;
	const coordinates = value['coordinates'];
	switch (value['type']) {
		case 'Point': {
			const p = position(coordinates);
			return p === undefined ? undefined : { type: 'Point', coordinates: p };
		}
		case 'LineString': {
			const line = positions(coordinates);
			return line === undefined || line.length < 2
				? undefined
				: { type: 'LineString', coordinates: line };
		}
		case 'Polygon': {
			if (!Array.isArray(coordinates)) return undefined;
			const rings: (readonly Position[])[] = [];
			for (const ring of coordinates) {
				const r = positions(ring);
				if (r === undefined || r.length < 4) return undefined;
				rings.push(r);
			}
			return rings.length === 0 ? undefined : { type: 'Polygon', coordinates: rings };
		}
		default:
			return undefined;
	}
};

const trimmedLabel = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
};

/**
 * A feature written by a previous version, by hand, or by a merge conflict
 * someone resolved in a text editor. Anything that does not parse is dropped
 * rather than repaired, because a half-understood hazard line is worse than none.
 */
export const parseAnnotation = (value: unknown): Annotation | undefined => {
	if (!isRecord(value)) return undefined;
	if (value['type'] !== 'Feature') return undefined;

	const shape = geometry(value['geometry']);
	if (shape === undefined) return undefined;

	const rawProperties = value['properties'];
	const properties: Readonly<Record<string, unknown>> = isRecord(rawProperties) ? rawProperties : {};

	const id = value['id'] ?? properties['id'];
	if (typeof id !== 'string' || id === '') return undefined;

	const kind = properties['kind'];

	return {
		id,
		kind: isKind(kind) ? kind : 'feature',
		label: trimmedLabel(properties['label']),
		geometry: shape
	};
};

export const parseCollection = (value: unknown): readonly Annotation[] => {
	if (!isRecord(value)) return [];
	const features = value['features'];
	if (!Array.isArray(features)) return [];

	const seen = new Set<string>();
	const out: Annotation[] = [];
	for (const raw of features) {
		const parsed = parseAnnotation(raw);
		if (parsed === undefined || seen.has(parsed.id)) continue;
		seen.add(parsed.id);
		out.push(parsed);
	}
	return out;
};

export interface AnnotationFeature {
	readonly type: 'Feature';
	readonly id: string;
	readonly properties: Readonly<Record<string, string>>;
	readonly geometry: AnnotationGeometry;
}

/**
 * `id` is repeated into properties because MapLibre drops the top-level id from
 * `querySourceFeatures` results for some source types, and the export has to be
 * readable by hand in a diff either way.
 */
export const toFeature = (annotation: Annotation): AnnotationFeature => {
	const properties: Record<string, string> = {
		id: annotation.id,
		kind: annotation.kind,
		colour: KINDS[annotation.kind].colour
	};
	if (annotation.label !== undefined) properties['label'] = annotation.label;
	return { type: 'Feature', id: annotation.id, properties, geometry: annotation.geometry };
};

/** Sorted so the file a user commits has a stable diff across sessions. */
export const toCollection = (
	annotations: readonly Annotation[]
): { readonly type: 'FeatureCollection'; readonly features: readonly AnnotationFeature[] } => ({
	type: 'FeatureCollection',
	features: [...annotations]
		.sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order || a.id.localeCompare(b.id))
		.map(toFeature)
});

/**
 * Everything that makes two annotations the same annotation, in a fixed order, so
 * the merge can ask "did this change" without a deep-equality walk. The id is not
 * part of it. Identity is what the fingerprint gets compared within.
 */
export const fingerprint = (annotation: Annotation): string =>
	JSON.stringify([
		annotation.kind,
		annotation.label ?? null,
		annotation.geometry.type,
		annotation.geometry.coordinates
	]);

export const newAnnotation = (kind: AnnotationKind, shape: AnnotationGeometry): Annotation => ({
	id: crypto.randomUUID(),
	kind,
	label: undefined,
	geometry: shape
});

export const geometryTypeOf = (annotation: Annotation): AnnotationGeometryType =>
	annotation.geometry.type;
