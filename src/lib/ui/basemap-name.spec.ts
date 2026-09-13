import { describe, expect, it } from 'vitest';
import { NO_BASE_MAP } from '$lib/domain/basemaps';
import { baseMapName, quickPairName } from './basemap-name';

describe('baseMapName', () => {
	it('puts the translated shelf before the archive that never translates', () => {
		expect(baseMapName('satellite-costa', 'en')).toBe('Satellite Costa');
		expect(baseMapName('classic-ign', 'en')).toBe('Classic IGN');
	});

	it('names the chart itself for no base map', () => {
		expect(baseMapName(NO_BASE_MAP, 'en')).toBe('None');
	});
});

describe('quickPairName', () => {
	it('names both maps the corner button flicks between, resting one first', () => {
		expect(quickPairName([NO_BASE_MAP, 'satellite-costa'], 'en')).toBe('None · Satellite Costa');
	});
});
