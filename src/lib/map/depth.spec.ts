import { describe, expect, it } from 'vitest';
import type { Map as MapLibre } from 'maplibre-gl';
import { depthAt } from './depth.ts';

/**
 * A stand-in for the two contour archives, answering with whatever lines a test
 * puts in them. `depthAt` reads the source rather than the rendered layers, which
 * is what makes it answerable without a GPU.
 */
const mapWith = (
	lines: Readonly<Record<string, readonly { depth: number; at: readonly [number, number][] }[]>>
): MapLibre =>
	({
		querySourceFeatures: (id: string) =>
			(lines[id] ?? []).map((line) => ({
				properties: { depth: line.depth },
				geometry: { type: 'LineString', coordinates: line.at.map(([lng, lat]) => [lng, lat]) }
			}))
	}) as unknown as MapLibre;

const AT = { lng: 3.24, lat: 42.045 };

/** Roughly this many degrees of latitude to the metre on this coast. */
const metres = (m: number): number => m / 111_320;

describe('the depth at one point', () => {
	it('takes the nearest contour, not the shallowest in the neighbourhood', () => {
		const map = mapWith({
			isobaths: [
				{ depth: 0, at: [[AT.lng, AT.lat + metres(400)]] },
				{ depth: 34, at: [[AT.lng, AT.lat + metres(12)]] },
				{ depth: 60, at: [[AT.lng, AT.lat - metres(90)]] }
			]
		});
		expect(depthAt(map, AT)).toBe(34);
	});

	it('reads both archives and lets the deep one win when it is closer', () => {
		const map = mapWith({
			isobaths: [{ depth: 78, at: [[AT.lng, AT.lat + metres(300)]] }],
			'isobaths-deep': [{ depth: 120, at: [[AT.lng, AT.lat + metres(30)]] }]
		});
		expect(depthAt(map, AT)).toBe(120);
	});

	it('walks every vertex, so a long contour counts where it passes closest', () => {
		const map = mapWith({
			isobaths: [
				{
					depth: 22,
					at: [
						[AT.lng, AT.lat + metres(900)],
						[AT.lng, AT.lat + metres(5)]
					]
				},
				{ depth: 45, at: [[AT.lng, AT.lat + metres(50)]] }
			]
		});
		expect(depthAt(map, AT)).toBe(22);
	});

	it('says nothing where the nearest line is further off than it is worth', () => {
		const map = mapWith({ isobaths: [{ depth: 30, at: [[AT.lng, AT.lat + metres(4000)]] }] });
		expect(depthAt(map, AT)).toBeUndefined();
	});

	it('says nothing where no archive has loaded a line at all', () => {
		expect(depthAt(mapWith({}), AT)).toBeUndefined();
	});
});
