import {
	TerraDraw,
	TerraDrawLineStringMode,
	TerraDrawPointMode,
	TerraDrawPolygonMode,
	TerraDrawSelectMode
} from 'terra-draw';
import type {
	GeoJSONStoreFeatures,
	GeoJSONStoreGeometries,
	HexColor,
	TerraDrawEventListeners
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
	type Annotation,
	type AnnotationGeometry,
	type AnnotationGeometryType,
	type Position,
	parseAnnotation,
	toCollection
} from './annotation.ts';

/**
 * Terra Draw owns the rubber band: the half-drawn line, the drag handles, the
 * vertex you are currently holding. The app owns what a shape means. The two
 * meet on the feature id, which is why the id strategy here is the app's own
 * `crypto.randomUUID()` rather than anything Terra Draw would mint for itself.
 *
 * This module is also the only place in the app that can name GeoJSON's geometry
 * types, because Terra Draw re-exports them and the bare `geojson` package does
 * not resolve from `src`. Both conversions therefore live here.
 */

export type ShapeMode = 'point' | 'linestring' | 'polygon';
export type DrawModeName = ShapeMode | 'select';

export interface DrawnShape {
	readonly id: string;
	readonly geometry: AnnotationGeometry;
}

export interface DrawCallbacks {
	/** A shape the user just finished. Its id is the one the app must keep. */
	ondraw: (shape: DrawnShape) => void;
	/** A shape the user dragged, resized or re-pointed. */
	ongeometry: (shape: DrawnShape) => void;
	onselect: (id: string | undefined) => void;
	colourOf: (id: string | undefined) => string;
}

export interface DrawHandle {
	setMode: (mode: DrawModeName) => void;
	/** Re-register after a style rebuild has taken the adapter's own layers away. */
	remount: () => void;
	finishShape: () => void;
	/** Returns the id it removed, so the caller can drop the same annotation. */
	deleteSelected: () => string | undefined;
	syncFeatures: (annotations: readonly Annotation[]) => void;
	destroy: () => void;
}

/** Wet hands on a moving boat need a fat tap radius everywhere. */
const POINTER_DISTANCE = 40;

const FINISH_KEY = 'Enter';
const CANCEL_KEY = 'Escape';

/** Paper, so a drag handle reads against every kind colour and the dark sea. */
const HANDLE = '#efe4cf';

const MODE_OF: Readonly<Record<AnnotationGeometryType, ShapeMode>> = {
	Point: 'point',
	LineString: 'linestring',
	Polygon: 'polygon'
};

/**
 * Midpoints, selection handles and the shape still under the cursor all live in
 * the same store as real features. None of them is an annotation.
 */
const TRANSIENT_PROPERTIES = [
	'midPoint',
	'selectionPoint',
	'coordinatePoint',
	'snappingPoint',
	'closingPoint',
	'currentlyDrawing'
] as const;

const isTransient = (feature: GeoJSONStoreFeatures): boolean =>
	TRANSIENT_PROPERTIES.some((key) => Boolean(feature.properties[key]));

const COORDINATE_PRECISION = 6;

/** Same rounding the adapter applies, so a point the app makes never churns the sync. */
export const roundPosition = (lng: number, lat: number): Position => [
	Number(lng.toFixed(COORDINATE_PRECISION)),
	Number(lat.toFixed(COORDINATE_PRECISION))
];

const hex = (colour: string): HexColor => `#${colour.replace(/^#/, '')}`;

const mutable = (position: readonly number[]): number[] => [...position];

export const toGeoJsonGeometry = (geometry: AnnotationGeometry): GeoJSONStoreGeometries => {
	switch (geometry.type) {
		case 'Point':
			return { type: 'Point', coordinates: mutable(geometry.coordinates) };
		case 'LineString':
			return { type: 'LineString', coordinates: geometry.coordinates.map(mutable) };
		case 'Polygon':
			return {
				type: 'Polygon',
				coordinates: geometry.coordinates.map((ring) => ring.map(mutable))
			};
	}
};

/** What `map.getSource('annotations').setData` wants, in the export's stable order. */
export const toSourceData = (
	annotations: readonly Annotation[]
): { type: 'FeatureCollection'; features: GeoJSONStoreFeatures[] } => ({
	type: 'FeatureCollection',
	features: toCollection(annotations).features.map((feature) => ({
		type: 'Feature',
		id: feature.id,
		properties: { ...feature.properties },
		geometry: toGeoJsonGeometry(feature.geometry)
	}))
});

const shapeKey = (geometry: { readonly type: string; readonly coordinates: unknown }): string =>
	JSON.stringify([geometry.type, geometry.coordinates]);

/** The domain parser doubles as the boundary guard on everything Terra Draw hands back. */
const geometryOf = (feature: GeoJSONStoreFeatures): AnnotationGeometry | undefined =>
	parseAnnotation(feature)?.geometry;

const toDrawFeature = (annotation: Annotation): GeoJSONStoreFeatures => ({
	type: 'Feature',
	id: annotation.id,
	properties: { mode: MODE_OF[annotation.geometry.type] },
	geometry: toGeoJsonGeometry(annotation.geometry)
});

export const createDraw = (map: MapLibreMap, callbacks: DrawCallbacks): DrawHandle => {
	const colour = (feature: GeoJSONStoreFeatures): HexColor =>
		hex(callbacks.colourOf(typeof feature.id === 'string' ? feature.id : undefined));

	const shapeKeys = { cancel: CANCEL_KEY, finish: FINISH_KEY };

	const draw = new TerraDraw({
		adapter: new TerraDrawMapLibreGLAdapter({
			map,
			coordinatePrecision: 6,
			minPixelDragDistance: 8,
			minPixelDragDistanceSelecting: 12
		}),
		idStrategy: {
			getId: () => crypto.randomUUID(),
			isValidId: (id) => typeof id === 'string' && id.length === 36
		},
		modes: [
			new TerraDrawPointMode({
				pointerDistance: POINTER_DISTANCE,
				styles: {
					pointColor: colour,
					pointWidth: 7,
					pointOutlineColor: HANDLE,
					pointOutlineWidth: 2
				}
			}),
			new TerraDrawLineStringMode({
				pointerDistance: POINTER_DISTANCE,
				keyEvents: shapeKeys,
				styles: {
					lineStringColor: colour,
					lineStringWidth: 4,
					closingPointColor: colour,
					closingPointWidth: 8,
					closingPointOutlineColor: HANDLE,
					closingPointOutlineWidth: 2
				}
			}),
			new TerraDrawPolygonMode({
				pointerDistance: POINTER_DISTANCE,
				keyEvents: shapeKeys,
				styles: {
					fillColor: colour,
					fillOpacity: 0.2,
					outlineColor: colour,
					outlineWidth: 3,
					closingPointColor: colour,
					closingPointWidth: 8,
					closingPointOutlineColor: HANDLE,
					closingPointOutlineWidth: 2
				}
			}),
			new TerraDrawSelectMode({
				pointerDistance: POINTER_DISTANCE,
				dragEventThrottle: 16,
				// Deleting is the app's job. Terra Draw doing it too would drop the
				// annotation from the map and leave the store still holding it.
				keyEvents: { deselect: CANCEL_KEY, delete: null, rotate: null, scale: null },
				flags: {
					point: { feature: { draggable: true } },
					linestring: {
						feature: {
							draggable: true,
							coordinates: { draggable: true, midpoints: true, deletable: true }
						}
					},
					polygon: {
						feature: {
							draggable: true,
							coordinates: { draggable: true, midpoints: true, deletable: true }
						}
					}
				},
				styles: {
					selectedPointColor: colour,
					selectedPointOutlineColor: HANDLE,
					selectedLineStringColor: colour,
					selectedPolygonColor: colour,
					selectedPolygonOutlineColor: colour,
					selectionPointColor: colour,
					selectionPointOutlineColor: HANDLE,
					selectionPointOutlineWidth: 2,
					midPointColor: colour,
					midPointOutlineColor: HANDLE
				}
			})
		]
	});

	let selectedId: string | undefined;

	const onFinish: TerraDrawEventListeners['finish'] = (id, context) => {
		if (context.action !== 'draw' || typeof id !== 'string') return;
		const feature = draw.getSnapshotFeature(id);
		if (feature === undefined) return;
		const geometry = geometryOf(feature);
		if (geometry === undefined) return;
		callbacks.ondraw({ id, geometry });
	};

	const onChange: TerraDrawEventListeners['change'] = (ids, type) => {
		if (type !== 'update') return;
		for (const id of ids) {
			if (typeof id !== 'string') continue;
			const feature = draw.getSnapshotFeature(id);
			if (feature === undefined || isTransient(feature)) continue;
			const geometry = geometryOf(feature);
			if (geometry === undefined) continue;
			callbacks.ongeometry({ id, geometry });
		}
	};

	const onSelect: TerraDrawEventListeners['select'] = (id) => {
		selectedId = typeof id === 'string' ? id : undefined;
		callbacks.onselect(selectedId);
	};

	const onDeselect: TerraDrawEventListeners['deselect'] = () => {
		selectedId = undefined;
		callbacks.onselect(undefined);
	};

	draw.on('finish', onFinish);
	draw.on('change', onChange);
	draw.on('select', onSelect);
	draw.on('deselect', onDeselect);
	draw.start();
	draw.setMode('select');

	let current: DrawModeName = 'select';

	return {
		setMode: (mode) => {
			current = mode;
			if (draw.enabled) draw.setMode(mode);
		},

		remount: () => {
			if (map.getSource('td-polygon') !== undefined) return;
			if (draw.enabled) draw.stop();
			draw.start();
			draw.setMode(current);
		},

		// The adapter listens for keys on the canvas, so the toolbar button says the
		// same thing to Terra Draw that the keyboard would.
		finishShape: () => {
			if (!draw.enabled) return;
			map.getCanvas().dispatchEvent(new KeyboardEvent('keyup', { key: FINISH_KEY, bubbles: true }));
		},

		deleteSelected: () => {
			if (selectedId === undefined || !draw.enabled) return undefined;
			const id = selectedId;
			draw.deselectFeature(id);
			draw.removeFeatures([id]);
			selectedId = undefined;
			return id;
		},

		syncFeatures: (annotations) => {
			// A style rebuild stops and restarts this between two renders, and the
			// callers are effects that do not know which side of it they are on.
			if (!draw.enabled) return;
			const wanted = new Map(annotations.map((a) => [a.id, a]));
			const held = new Set<string>();
			const stale: string[] = [];

			for (const feature of draw.getSnapshot()) {
				const id = feature.id;
				if (typeof id !== 'string' || isTransient(feature)) continue;
				const annotation = wanted.get(id);
				if (annotation === undefined) {
					stale.push(id);
					continue;
				}
				held.add(id);
				const target = toGeoJsonGeometry(annotation.geometry);
				if (shapeKey(feature.geometry) !== shapeKey(target)) {
					draw.updateFeatureGeometry(id, target);
				}
			}

			if (stale.length > 0) draw.removeFeatures(stale);

			const missing = annotations.filter((a) => !held.has(a.id)).map(toDrawFeature);
			if (missing.length === 0) return;
			for (const result of draw.addFeatures(missing)) {
				if (!result.valid) console.warn('terra-draw rejected an annotation', result.id, result.reason);
			}
		},

		destroy: () => {
			draw.off('finish', onFinish);
			draw.off('change', onChange);
			draw.off('select', onSelect);
			draw.off('deselect', onDeselect);
			if (draw.enabled) draw.stop();
		}
	};
};
