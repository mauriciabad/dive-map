import type { Locale } from '$lib/i18n/locale';

/**
 * These belong in `$lib/i18n/messages.ts` beside the rest of the interface and
 * are only separate because this change was not allowed to write that file. The
 * shape is deliberately identical, so folding them in is a paste: Catalan is the
 * source of truth and the other two are typed against it, which is what turns a
 * missing translation into a compile error rather than a blank label on a boat.
 */

const ca = {
	annotate: 'Anotar',
	annotateHint: 'Dibuixa sobre el mapa. Es desa al navegador fins que l’exportis.',
	kindEntry: 'Entrada i sortida',
	kindRoute: 'Recorregut',
	kindHazard: 'Perill',
	kindFeature: 'Punt d’interès',
	kindGroup: 'Tipus d’anotació',
	toolGroup: 'Eines de dibuix',
	drawPoint: 'Punt',
	drawLine: 'Línia',
	drawArea: 'Àrea',
	drawSelect: 'Seleccionar i moure',
	drawPointHint: 'Toca el mapa per posar un punt.',
	drawLineHint: 'Toca per cada vèrtex. Acaba la forma quan hagis acabat.',
	drawAreaHint: 'Toca per cada cantonada. Acaba la forma per tancar-la.',
	drawSelectHint: 'Toca una anotació per moure-la o esborrar-la.',
	finishShape: 'Acabar la forma',
	pointAtCentre: 'Posar un punt al centre del mapa',
	undo: 'Desfer',
	deleteSelected: 'Esborrar la selecció',
	labelField: 'Etiqueta',
	labelPlaceholder: 'Sense etiqueta',
	annotationCount: '{n} anotacions',
	noAnnotations: 'Cap anotació encara',
	exportGeojson: 'Exportar GeoJSON',
	exportHint: 'Desa el fitxer a static/data/annotations.geojson i fes-ne un commit.',
	conflictTitle: 'El fitxer del repositori ha canviat',
	conflictBody: '{n} anotacions han canviat als dos costats. Tries tu.',
	keepMine: 'Mantenir el meu dibuix',
	useFile: 'Fer servir el fitxer',
	arrivedFromRepo: '{n} anotacions noves del repositori',
	withdrawnFromRepo: '{n} anotacions retirades del repositori',
	dismiss: 'Descartar l’avís',
	storageUnavailable: 'El navegador no desa res. Exporta abans de tancar la pestanya.',
	addedAnnotation: '{kind} afegida. {n} anotacions en total.',
	deletedAnnotation: 'Anotació esborrada. {n} anotacions en total.',
	movedAnnotation: 'Anotació moguda.',
	undoneAnnotation: 'Desfet. {n} anotacions en total.'
} as const;

type Catalogue = Record<keyof typeof ca, string>;

const es: Catalogue = {
	annotate: 'Anotar',
	annotateHint: 'Dibuja sobre el mapa. Se guarda en el navegador hasta que lo exportes.',
	kindEntry: 'Entrada y salida',
	kindRoute: 'Recorrido',
	kindHazard: 'Peligro',
	kindFeature: 'Punto de interés',
	kindGroup: 'Tipo de anotación',
	toolGroup: 'Herramientas de dibujo',
	drawPoint: 'Punto',
	drawLine: 'Línea',
	drawArea: 'Área',
	drawSelect: 'Seleccionar y mover',
	drawPointHint: 'Toca el mapa para poner un punto.',
	drawLineHint: 'Toca en cada vértice. Termina la forma cuando acabes.',
	drawAreaHint: 'Toca en cada esquina. Termina la forma para cerrarla.',
	drawSelectHint: 'Toca una anotación para moverla o borrarla.',
	finishShape: 'Terminar la forma',
	pointAtCentre: 'Poner un punto en el centro del mapa',
	undo: 'Deshacer',
	deleteSelected: 'Borrar la selección',
	labelField: 'Etiqueta',
	labelPlaceholder: 'Sin etiqueta',
	annotationCount: '{n} anotaciones',
	noAnnotations: 'Ninguna anotación todavía',
	exportGeojson: 'Exportar GeoJSON',
	exportHint: 'Guarda el archivo en static/data/annotations.geojson y haz un commit.',
	conflictTitle: 'El archivo del repositorio ha cambiado',
	conflictBody: '{n} anotaciones han cambiado en ambos lados. Eliges tú.',
	keepMine: 'Mantener mi dibujo',
	useFile: 'Usar el archivo',
	arrivedFromRepo: '{n} anotaciones nuevas del repositorio',
	withdrawnFromRepo: '{n} anotaciones retiradas del repositorio',
	dismiss: 'Descartar el aviso',
	storageUnavailable: 'El navegador no guarda nada. Exporta antes de cerrar la pestaña.',
	addedAnnotation: '{kind} añadida. {n} anotaciones en total.',
	deletedAnnotation: 'Anotación borrada. {n} anotaciones en total.',
	movedAnnotation: 'Anotación movida.',
	undoneAnnotation: 'Deshecho. {n} anotaciones en total.'
};

const en: Catalogue = {
	annotate: 'Annotate',
	annotateHint: 'Draw on the map. Kept in this browser until you export it.',
	kindEntry: 'Entry and exit',
	kindRoute: 'Swim route',
	kindHazard: 'Hazard',
	kindFeature: 'Worth seeing',
	kindGroup: 'Annotation kind',
	toolGroup: 'Drawing tools',
	drawPoint: 'Point',
	drawLine: 'Line',
	drawArea: 'Area',
	drawSelect: 'Select and move',
	drawPointHint: 'Tap the map to drop a point.',
	drawLineHint: 'Tap at each vertex. Finish the shape when you are done.',
	drawAreaHint: 'Tap at each corner. Finish the shape to close it.',
	drawSelectHint: 'Tap an annotation to move or delete it.',
	finishShape: 'Finish the shape',
	pointAtCentre: 'Drop a point at the map centre',
	undo: 'Undo',
	deleteSelected: 'Delete the selection',
	labelField: 'Label',
	labelPlaceholder: 'No label',
	annotationCount: '{n} annotations',
	noAnnotations: 'No annotations yet',
	exportGeojson: 'Export GeoJSON',
	exportHint: 'Save the file to static/data/annotations.geojson and commit it.',
	conflictTitle: 'The repository file changed',
	conflictBody: '{n} annotations changed on both sides. You choose.',
	keepMine: 'Keep my drawing',
	useFile: 'Use the file',
	arrivedFromRepo: '{n} new annotations from the repository',
	withdrawnFromRepo: '{n} annotations withdrawn from the repository',
	dismiss: 'Dismiss the notice',
	storageUnavailable: 'This browser is not saving anything. Export before closing the tab.',
	addedAnnotation: '{kind} added. {n} annotations in total.',
	deletedAnnotation: 'Annotation deleted. {n} annotations in total.',
	movedAnnotation: 'Annotation moved.',
	undoneAnnotation: 'Undone. {n} annotations in total.'
};

export type AnnotateKey = keyof Catalogue;

const CATALOGUES: Record<Locale, Catalogue> = { ca, es, en };

export const at = (
	locale: Locale,
	key: AnnotateKey,
	values?: Record<string, number | string>
): string => {
	const template = CATALOGUES[locale][key];
	if (values === undefined) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole));
};
