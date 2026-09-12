import type { Locale } from '$lib/i18n/locale';

/**
 * The print panel's strings, in the shape `$lib/i18n/messages.ts` uses.
 *
 * To merge: spread `PRINT_MESSAGES.ca` into that file's `ca`, `.es` into `es`
 * and `.en` into `en`, delete this file and swap `pt` for `t` at the four call
 * sites. Catalan is the source of truth there and here, so the other two are
 * typed against it and a missing translation is a compile error.
 */

const ca = {
	printName: 'Nom del full',
	printSize: 'Mida',
	printStock: 'Mides habituals',
	printCustomMm: 'A mida',
	printCustomPx: 'Píxels',
	printWidth: 'Amplada',
	printHeight: 'Alçada',
	printDensity: 'Densitat',
	printSwap: 'Gira els costats',
	printFrameBy: 'Enquadrament',
	printByScale: 'Per escala',
	printByZoom: 'Per zoom',
	printZoom: 'Zoom',
	printCoverage: 'Terreny',
	printElements: 'Elements',
	printAll: 'Tots',
	printNone: 'Cap',
	printTitleRow: 'Títol',
	printDepthRow: 'Fondària màxima',
	printLegendRow: 'Llegenda',
	printScaleBarRow: 'Escala gràfica',
	printNorthRow: 'Nord',
	printDisclaimerRow: 'Avís de no navegació',
	printAttributionRow: 'Atribució',
	printLegalNote:
		'La llicència de les dades demana l’atribució, i l’ICGC diu que la seva batimetria no serveix per navegar. Treure-les és cosa teva.',
	printExportPng: 'Exportar PNG',
	printTooLarge:
		'Aquesta mida supera el que el navegador pot dibuixar. Abaixa la densitat o la mida.',
	printPdfNeedsPaper: 'El PDF necessita una mida en paper. En píxels, exporta PNG.',
	printRuler: 'La barra fa {n} mm sobre el paper',
	printPixelsHaveNoScale: 'Una imatge no té escala: el full es mesura en zoom i metres.'
} as const;

export type PrintMessageKey = keyof typeof ca;

const es: Record<PrintMessageKey, string> = {
	printName: 'Nombre de la hoja',
	printSize: 'Tamaño',
	printStock: 'Tamaños habituales',
	printCustomMm: 'A medida',
	printCustomPx: 'Píxeles',
	printWidth: 'Ancho',
	printHeight: 'Alto',
	printDensity: 'Densidad',
	printSwap: 'Gira los lados',
	printFrameBy: 'Encuadre',
	printByScale: 'Por escala',
	printByZoom: 'Por zoom',
	printZoom: 'Zoom',
	printCoverage: 'Terreno',
	printElements: 'Elementos',
	printAll: 'Todos',
	printNone: 'Ninguno',
	printTitleRow: 'Título',
	printDepthRow: 'Profundidad máxima',
	printLegendRow: 'Leyenda',
	printScaleBarRow: 'Escala gráfica',
	printNorthRow: 'Norte',
	printDisclaimerRow: 'Aviso de no navegación',
	printAttributionRow: 'Atribución',
	printLegalNote:
		'La licencia de los datos pide la atribución, y el ICGC dice que su batimetría no sirve para navegar. Quitarlas es cosa tuya.',
	printExportPng: 'Exportar PNG',
	printTooLarge:
		'Este tamaño supera lo que el navegador puede dibujar. Baja la densidad o el tamaño.',
	printPdfNeedsPaper: 'El PDF necesita un tamaño en papel. En píxeles, exporta PNG.',
	printRuler: 'La barra mide {n} mm sobre el papel',
	printPixelsHaveNoScale: 'Una imagen no tiene escala: la hoja se mide en zoom y metros.'
};

const en: Record<PrintMessageKey, string> = {
	printName: 'Sheet name',
	printSize: 'Size',
	printStock: 'Common sizes',
	printCustomMm: 'Custom',
	printCustomPx: 'Pixels',
	printWidth: 'Width',
	printHeight: 'Height',
	printDensity: 'Density',
	printSwap: 'Swap the sides',
	printFrameBy: 'Framing',
	printByScale: 'By scale',
	printByZoom: 'By zoom',
	printZoom: 'Zoom',
	printCoverage: 'Ground',
	printElements: 'Elements',
	printAll: 'All',
	printNone: 'None',
	printTitleRow: 'Title',
	printDepthRow: 'Maximum depth',
	printLegendRow: 'Legend',
	printScaleBarRow: 'Scale bar',
	printNorthRow: 'North',
	printDisclaimerRow: 'Not-for-navigation line',
	printAttributionRow: 'Attribution',
	printLegalNote:
		'The data licence asks for the attribution, and ICGC says its bathymetry is not for navigation. Taking them off is your call.',
	printExportPng: 'Export PNG',
	printTooLarge: 'This size is past what the browser will draw. Lower the density or the size.',
	printPdfNeedsPaper: 'A PDF needs a size on paper. In pixels, export a PNG.',
	printRuler: 'The bar measures {n} mm on paper',
	printPixelsHaveNoScale: 'An image has no scale, so the sheet is measured in zoom and metres.'
};

export const PRINT_MESSAGES: Record<Locale, Record<PrintMessageKey, string>> = { ca, es, en };

export const pt = (
	locale: Locale,
	key: PrintMessageKey,
	values?: Record<string, number | string>
): string => {
	const template = PRINT_MESSAGES[locale][key];
	if (values === undefined) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole));
};
