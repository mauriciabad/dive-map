import { type DiveCard, planFor } from '$lib/domain/card';
import { renderZoom } from '$lib/domain/print';
import type { Locale } from '$lib/i18n/locale';
import type { StyleOptions } from '$lib/map/style';
import { northPlateBox } from './furniture.ts';
import { composeCardPdf } from './pdf.ts';
import { composeCardPng } from './png.ts';
import { PRINT_PIXEL_RATIO, renderCard } from './render.ts';

/** The whole export, from framing to a file on disk. */

export type SheetFormat = 'pdf' | 'png';

export interface SheetReport {
	/**
	 * Empty when the sheet is whole. Anything listed is something the file on disk
	 * is missing, and the panel says so.
	 *
	 * A tile that fails to fetch no longer abandons the export, because a sheet with
	 * a hole in one corner beats no sheet at all on a boat. That trade only holds if
	 * the hole is announced: a card that prints with a corner missing and reports
	 * success is worse than one that refuses to export.
	 */
	readonly problems: readonly string[];
}

const slug = (title: string): string => {
	const cleaned = title
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^\w]+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();
	return cleaned.length > 0 ? cleaned : 'full';
};

const download = (blob: Blob, filename: string): void => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
};

/**
 * pdf-lib hands back a view over a buffer the DOM's Blob types will not accept,
 * because it could be shared memory. Copying into a plain ArrayBuffer is the
 * conversion that does not need a cast.
 */
const ownBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
};

export const exportSheet = async (input: {
	readonly card: DiveCard;
	readonly style: StyleOptions;
	readonly locale: Locale;
	readonly format: SheetFormat;
}): Promise<SheetReport> => {
	const { card, style, locale, format } = input;
	const plan = planFor(card);
	const rendered = await renderCard(card, style);
	const blob =
		format === 'pdf'
			? new Blob([ownBuffer(await composeCardPdf(card, plan, rendered, locale))], {
					type: 'application/pdf'
				})
			: await composeCardPng(card, plan, rendered, locale);

	if (import.meta.env.DEV) {
		// Everything but the image, so the verification script can read it back.
		Reflect.set(window, 'lastRender', {
			format,
			width: rendered.width,
			height: rendered.height,
			clamped: rendered.clamped,
			complete: rendered.complete,
			pixelSpread: rendered.pixelSpread,
			problems: rendered.problems,
			missingImages: rendered.missingImages,
			habitatCodes: rendered.habitatCodes,
			maxDepthM: rendered.maxDepthM ?? null,
			pageMm: plan.paper?.pageMm ?? null,
			trimMm: plan.paper?.trimMm ?? null,
			bleedMm: plan.paper?.bleedMm ?? 0,
			scale: plan.paper?.scale ?? null,
			bearing: card.bearing,
			// So a check can find the arrow on the finished sheet and read off which
			// way it actually points, rather than recomputing the rotation and
			// agreeing with itself.
			northPlate: northPlateBox(plan),
			groundWidthM: plan.groundWidthM,
			groundHeightM: plan.groundHeightM,
			zoom: plan.zoom,
			renderZoom: renderZoom(plan, PRINT_PIXEL_RATIO),
			byteLength: blob.size
		});
	}

	download(blob, `${slug(card.title)}.${format}`);
	return {
		problems: [
			...(rendered.complete ? [] : ['tiles were still arriving when the sheet was captured']),
			...rendered.problems
		]
	};
};
