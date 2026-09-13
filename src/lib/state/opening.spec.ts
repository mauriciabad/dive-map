import { describe, expect, it } from 'vitest';
import { NEAR_SURVEY_M, SURVEY_CENTRE, metresFromSurvey, nearSurvey } from './opening.ts';

/**
 * Places rather than coordinates, because the question this answers is a place
 * question: would opening the map on this person put them over water this map
 * has something to say about.
 */
const WHERE = {
	offBegur: { lng: 3.2165, lat: 41.9275 },
	barcelona: { lng: 2.1734, lat: 41.3851 },
	lleida: { lng: 0.6266, lat: 41.6176 },
	madrid: { lng: -3.7038, lat: 40.4168 },
	sardinia: { lng: 9.1, lat: 39.2 }
};

describe('how far a diver is from the survey', () => {
	it('puts the water this map was built for inside it', () => {
		expect(metresFromSurvey(WHERE.offBegur)).toBe(0);
	});

	it('counts a coastal city as being at the coast', () => {
		expect(nearSurvey(WHERE.barcelona)).toBe(true);
	});

	it('does not count somewhere two hours inland', () => {
		expect(nearSurvey(WHERE.lleida)).toBe(false);
		expect(metresFromSurvey(WHERE.lleida)).toBeGreaterThan(50_000);
	});

	it('leaves anyone planning the trip from elsewhere where the map opens', () => {
		expect(nearSurvey(WHERE.madrid)).toBe(false);
		expect(nearSurvey(WHERE.sardinia)).toBe(false);
	});

	/** The threshold is a product decision, so a change to it should be deliberate. */
	it('draws the line at twenty-five kilometres', () => {
		expect(NEAR_SURVEY_M).toBe(25_000);
	});
});

describe('where the whole survey is centred', () => {
	it('lands in Catalan waters rather than off the end of the coast', () => {
		expect(SURVEY_CENTRE.lng).toBeGreaterThan(1.5);
		expect(SURVEY_CENTRE.lng).toBeLessThan(2.5);
		expect(SURVEY_CENTRE.lat).toBeGreaterThan(41);
		expect(SURVEY_CENTRE.lat).toBeLessThan(42);
	});
});
