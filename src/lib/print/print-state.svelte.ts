import { SvelteSet } from 'svelte/reactivity';
import {
	DEFAULT_FRAMING,
	DEFAULT_FURNITURE,
	DEFAULT_SHEET,
	type Framing,
	type FurnitureId,
	type Orientation,
	type Sheet,
	type SheetPlan,
	type StockId,
	asZoomFraming,
	planSheet,
	sheetPixels,
	sheetSizeMm
} from '$lib/domain/print';
import type { DiveCard, IsobathStyle, LayerId, LngLat } from '$lib/domain/card';
import { type ScaleDenominator, scale } from '$lib/domain/units';
import type { SheetFormat } from './export';

/**
 * Everything the print panel owns. It is deliberately separate from MapState:
 * the sheet is a thing you are making, the map is a thing you are looking at,
 * and only the camera crosses between them.
 *
 * The one invariant worth the code it costs: a sheet specified in pixels has no
 * physical size, so it cannot be framed by a scale ratio. Every transition that
 * could break that converts the framing instead of leaving a ratio behind.
 */

/** What the print path needs from the live map, without depending on the class that holds it. */
export interface LiveView {
	readonly centre: LngLat;
	readonly bearing: number;
	readonly layers: readonly LayerId[];
	readonly isobaths: IsobathStyle;
	readonly groundLayer: 'habitats' | 'substrate';
	readonly smoothed: boolean;
}

const MM_BOUNDS = { low: 20, high: 2000 } as const;
const PX_BOUNDS = { low: 200, high: 20_000 } as const;
const ZOOM_BOUNDS = { low: 6, high: 22 } as const;

const clamp = (value: number, low: number, high: number): number =>
	Math.min(high, Math.max(low, Math.round(value)));

export class PrintState {
	/** Kept across sheet changes so reprinting the same card keeps its identity. */
	readonly id = crypto.randomUUID();

	title = $state('');
	subtitle = $state('');
	sheet = $state.raw<Sheet>(DEFAULT_SHEET);
	framing = $state.raw<Framing>(DEFAULT_FRAMING);
	readonly furniture = new SvelteSet<FurnitureId>(DEFAULT_FURNITURE);
	format = $state<SheetFormat>('pdf');
	busy = $state(false);
	error = $state<string | undefined>(undefined);
	/**
	 * What the last exported sheet came back missing. The file is on disk either
	 * way, so this line is the only thing between a diver and a card with a hole in
	 * it that looks finished.
	 */
	problems = $state.raw<readonly string[]>([]);

	/** So a trip through a custom size and back does not silently lose the A4 you picked. */
	#lastStock: StockId = 'A3';

	/** A raster has no page, so a ratio is not something it can be framed by. */
	get framesByScale(): boolean {
		return this.sheet.kind !== 'pixels';
	}

	get exportsPdf(): boolean {
		return this.sheet.kind !== 'pixels';
	}

	plan(live: LiveView): SheetPlan {
		return planSheet(this.sheet, this.framing, live.centre.lat);
	}

	card(live: LiveView): DiveCard {
		return {
			id: this.id,
			title: this.title.trim(),
			subtitle: this.subtitle.trim().length > 0 ? this.subtitle.trim() : undefined,
			osmRef: undefined,
			centre: live.centre,
			framing: this.framing,
			bearing: live.bearing,
			sheet: this.sheet,
			layers: live.layers,
			furniture: [...this.furniture],
			isobaths: live.isobaths,
			annotationIds: []
		};
	}

	#reframe(sheet: Sheet, latitudeDeg: number): void {
		if (sheet.kind === 'pixels') {
			this.framing = asZoomFraming(this.framing, this.sheet, latitudeDeg);
			this.format = 'png';
		}
		this.sheet = sheet;
	}

	useStock(latitudeDeg: number): void {
		if (this.sheet.kind === 'stock') return;
		this.#reframe(
			{ kind: 'stock', stock: this.#lastStock, orientation: 'portrait', dpi: this.#dpi() },
			latitudeDeg
		);
	}

	useMillimetres(latitudeDeg: number): void {
		if (this.sheet.kind === 'millimetres') return;
		const size = sheetSizeMm(this.sheet) ?? { widthMm: 297, heightMm: 420 };
		this.#reframe(
			{
				kind: 'millimetres',
				widthMm: Math.round(size.widthMm),
				heightMm: Math.round(size.heightMm),
				dpi: this.#dpi()
			},
			latitudeDeg
		);
	}

	usePixels(latitudeDeg: number): void {
		if (this.sheet.kind === 'pixels') return;
		// Seeded with the raster this sheet would have produced, then edited as
		// pixels. It is a starting number, not a claim that the two are the same.
		const { width, height } = sheetPixels(this.sheet);
		this.#reframe(
			{
				kind: 'pixels',
				widthPx: clamp(width, PX_BOUNDS.low, PX_BOUNDS.high),
				heightPx: clamp(height, PX_BOUNDS.low, PX_BOUNDS.high)
			},
			latitudeDeg
		);
	}

	#dpi(): number {
		return this.sheet.kind === 'pixels' ? 200 : this.sheet.dpi;
	}

	setStock(stock: StockId): void {
		if (this.sheet.kind !== 'stock') return;
		this.#lastStock = stock;
		this.sheet = { ...this.sheet, stock };
	}

	setOrientation(orientation: Orientation): void {
		if (this.sheet.kind !== 'stock') return;
		this.sheet = { ...this.sheet, orientation };
	}

	setDpi(dpi: number): void {
		if (this.sheet.kind === 'pixels') return;
		this.sheet = { ...this.sheet, dpi };
	}

	setMillimetres(widthMm: number, heightMm: number): void {
		if (this.sheet.kind !== 'millimetres') return;
		this.sheet = {
			...this.sheet,
			widthMm: clamp(widthMm, MM_BOUNDS.low, MM_BOUNDS.high),
			heightMm: clamp(heightMm, MM_BOUNDS.low, MM_BOUNDS.high)
		};
	}

	setPixels(widthPx: number, heightPx: number): void {
		if (this.sheet.kind !== 'pixels') return;
		this.sheet = {
			kind: 'pixels',
			widthPx: clamp(widthPx, PX_BOUNDS.low, PX_BOUNDS.high),
			heightPx: clamp(heightPx, PX_BOUNDS.low, PX_BOUNDS.high)
		};
	}

	/** Orientation for a size nobody named: the two numbers change places. */
	swapSides(): void {
		const sheet = this.sheet;
		switch (sheet.kind) {
			case 'stock':
				this.setOrientation(sheet.orientation === 'portrait' ? 'landscape' : 'portrait');
				return;
			case 'millimetres':
				this.sheet = { ...sheet, widthMm: sheet.heightMm, heightMm: sheet.widthMm };
				return;
			case 'pixels':
				this.sheet = { kind: 'pixels', widthPx: sheet.heightPx, heightPx: sheet.widthPx };
				return;
		}
	}

	setScale(denominator: ScaleDenominator): void {
		if (!this.framesByScale) return;
		this.framing = { by: 'scale', scale: denominator };
	}

	setZoom(zoom: number): void {
		this.framing = {
			by: 'zoom',
			zoom: Math.min(ZOOM_BOUNDS.high, Math.max(ZOOM_BOUNDS.low, zoom))
		};
	}

	/**
	 * Switching to a ratio keeps the sheet where it is: the nearest listed scale to
	 * what the zoom was already showing, so the framing does not jump under the
	 * crop box the moment the control is touched.
	 */
	frameByScale(choices: readonly ScaleDenominator[], live: LiveView): void {
		if (!this.framesByScale || this.framing.by === 'scale') return;
		const current = this.plan(live).paper?.scale ?? scale(2000);
		const nearest = choices.reduce(
			(best, option) => (Math.abs(option - current) < Math.abs(best - current) ? option : best),
			choices[0] ?? scale(2000)
		);
		this.framing = { by: 'scale', scale: nearest };
	}

	frameByZoom(live: LiveView): void {
		if (this.framing.by === 'zoom') return;
		this.framing = { by: 'zoom', zoom: this.plan(live).zoom };
	}

	shows(id: FurnitureId): boolean {
		return this.furniture.has(id);
	}

	toggleFurniture(id: FurnitureId): void {
		if (!this.furniture.delete(id)) this.furniture.add(id);
	}

	showAllFurniture(): void {
		for (const id of DEFAULT_FURNITURE) this.furniture.add(id);
	}

	hideAllFurniture(): void {
		this.furniture.clear();
	}
}
