import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress } from './address.ts';
import type { Camera } from './configuration.ts';

const MEDES: Camera = { centre: { lng: 3.21654, lat: 41.92751 }, zoom: 15.2, bearing: 0 };

describe('reading a link', () => {
	it('reads zoom, latitude and longitude', () => {
		expect(parseAddress('?map=15.2/41.92751/3.21654').camera).toEqual(MEDES);
	});

	it('reads a bearing when the link carries one', () => {
		expect(parseAddress('?map=15.2/41.92751/3.21654/120').camera?.bearing).toBe(120);
	});

	it('reads an OSM reference', () => {
		expect(parseAddress('?osm=node/1234567').osm).toEqual({ type: 'node', id: 1234567 });
	});

	it('reads both at once', () => {
		const address = parseAddress('?map=16/41.9/3.2&osm=way/987');
		expect(address.camera?.zoom).toBe(16);
		expect(address.osm).toEqual({ type: 'way', id: 987 });
	});

	it('works without the leading question mark, which is how some clients hand it over', () => {
		expect(parseAddress('map=16/41.9/3.2').camera?.zoom).toBe(16);
	});

	it('still reads a link written while the scheme lived in the fragment', () => {
		expect(parseAddress('#map=15.2/41.92751/3.21654').camera).toEqual(MEDES);
	});

	it('drops a place no map can accept', () => {
		expect(parseAddress('?map=15/91/3.2').camera).toBeUndefined();
		expect(parseAddress('?map=15/41.9/200').camera).toBeUndefined();
		expect(parseAddress('?map=99/41.9/3.2').camera).toBeUndefined();
	});

	it('drops a place with a field missing rather than reading it as the equator', () => {
		expect(parseAddress('?map=15//3.2').camera).toBeUndefined();
		expect(parseAddress('?map=15/41.9').camera).toBeUndefined();
	});

	it('drops a reference to something OSM does not have', () => {
		expect(parseAddress('?osm=chunk/12').osm).toBeUndefined();
		expect(parseAddress('?osm=node/-4').osm).toBeUndefined();
		expect(parseAddress('?osm=node/abc').osm).toBeUndefined();
	});

	it('keeps the half it can read', () => {
		const address = parseAddress('?map=16/41.9/3.2&osm=node/nonsense');
		expect(address.camera?.zoom).toBe(16);
		expect(address.osm).toBeUndefined();
	});

	it('reads nothing out of nothing', () => {
		expect(parseAddress('')).toEqual({ camera: undefined, osm: undefined });
		expect(parseAddress('?')).toEqual({ camera: undefined, osm: undefined });
	});
});

describe('writing a link', () => {
	it('comes back through the parser unchanged', () => {
		expect(parseAddress(formatAddress({ camera: MEDES, osm: undefined })).camera).toEqual(MEDES);
	});

	it('leaves a north-up bearing out', () => {
		expect(formatAddress({ camera: MEDES, osm: undefined })).toBe('?map=15.2/41.92751/3.21654');
	});

	it('carries a bearing that is not north', () => {
		const turned: Camera = { ...MEDES, bearing: 119.96 };
		expect(formatAddress({ camera: turned, osm: undefined })).toBe(
			'?map=15.2/41.92751/3.21654/120'
		);
	});

	it('rounds to something a person can paste', () => {
		const exact: Camera = {
			centre: { lng: 3.216_543_219, lat: 41.927_512_345 },
			zoom: 15.234_567,
			bearing: 0
		};
		expect(formatAddress({ camera: exact, osm: undefined })).toBe('?map=15.23/41.92751/3.21654');
	});

	it('carries the open feature beside the place', () => {
		expect(formatAddress({ camera: MEDES, osm: { type: 'node', id: 42 } })).toBe(
			'?map=15.2/41.92751/3.21654&osm=node/42'
		);
	});

	it('writes nothing when there is nothing to say', () => {
		expect(formatAddress({ camera: undefined, osm: undefined })).toBe('');
	});

	it('keeps a field the scheme does not own, behind its own', () => {
		expect(formatAddress({ camera: MEDES, osm: undefined }, '?from=whatsapp')).toBe(
			'?map=15.2/41.92751/3.21654&from=whatsapp'
		);
	});

	it('writes over the place already in the link rather than beside it', () => {
		const again = formatAddress({ camera: MEDES, osm: undefined }, '?map=9/40/1&osm=way/3');
		expect(again).toBe('?map=15.2/41.92751/3.21654');
	});

	it('keeps a foreign field when there is no place left to write', () => {
		expect(formatAddress({ camera: undefined, osm: undefined }, '?from=whatsapp')).toBe(
			'?from=whatsapp'
		);
	});
});
