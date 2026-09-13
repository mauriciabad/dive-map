import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FURNITURE,
	type PrintSettings,
	parsePrintSettings,
	planSheet
} from '$lib/domain/print';
import { scale } from '$lib/domain/units';
import { PrintState } from './print-state.svelte.ts';

/**
 * The rule this class exists to hold: a sheet measured in pixels has no physical
 * size, so it cannot be framed by a scale ratio. Restoring a saved setup is the
 * one path that can arrive holding both, because the blob may have been written
 * by an older build or edited by hand.
 */

const HERE = 41.95;

describe('restoring a saved sheet', () => {
	it('gives back what it was asked for', () => {
		const state = new PrintState();
		const settings: PrintSettings = {
			sheet: { kind: 'millimetres', widthMm: 500, heightMm: 250, dpi: 150, bleedMm: 3 },
			framing: { by: 'zoom', zoom: 18.5 },
			furniture: ['title', 'northArrow']
		};
		state.apply(settings, HERE);
		expect(state.settings).toEqual(settings);
	});

	it('round-trips through storage without drifting', () => {
		const state = new PrintState();
		state.useMillimetres(HERE);
		state.setMillimetres(420, 297);
		state.setBleed(5);
		state.setDpi(300);
		state.hideAllFurniture();
		state.toggleFurniture('scaleBar');

		const back = parsePrintSettings(JSON.parse(JSON.stringify(state.settings)));
		expect(back).toEqual(state.settings);

		const other = new PrintState();
		if (back !== undefined) other.apply(back, HERE);
		expect(other.settings).toEqual(state.settings);
	});

	it('turns a stored ratio into a zoom when the sheet turns out to be a raster', () => {
		const state = new PrintState();
		state.apply(
			{
				sheet: { kind: 'pixels', widthPx: 1600, heightPx: 1200 },
				framing: { by: 'scale', scale: scale(2000) },
				furniture: DEFAULT_FURNITURE
			},
			HERE
		);
		expect(state.framing.by).toBe('zoom');
		expect(state.framesByScale).toBe(false);
		// And the framing it lands on still shows the ground the ratio meant, rather
		// than some default the diver never chose.
		const plan = planSheet(state.sheet, state.framing, HERE);
		expect(plan.groundMetresPerPixel).toBeCloseTo(0.254, 3);
	});

	it('keeps the stock it was given, so a later switch back does not lose it', () => {
		const state = new PrintState();
		state.apply(
			{
				sheet: { kind: 'stock', stock: 'A5', orientation: 'landscape', dpi: 150, bleedMm: 0 },
				framing: { by: 'scale', scale: scale(1000) },
				furniture: DEFAULT_FURNITURE
			},
			HERE
		);
		state.usePixels(HERE);
		state.useStock(HERE);
		expect(state.sheet).toMatchObject({ kind: 'stock', stock: 'A5' });
	});

	it('clamps a zoom nobody can render rather than taking it as given', () => {
		const state = new PrintState();
		state.apply(
			{
				sheet: { kind: 'pixels', widthPx: 900, heightPx: 900 },
				framing: { by: 'zoom', zoom: 99 },
				furniture: []
			},
			HERE
		);
		expect(state.framing).toEqual({ by: 'zoom', zoom: 22 });
		expect(state.settings.furniture).toEqual([]);
	});
});
