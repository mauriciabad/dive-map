import type { Locale } from './locale';

/**
 * Catalan is the source of truth. The other two catalogues are typed against its
 * shape, so a missing translation fails the build rather than showing a blank
 * label to someone on a boat.
 */
const ca = {
	appName: 'Mapa de busseig',
	layers: 'Capes',
	isobaths: 'Isòbates',
	ground: 'Fons',
	habitats: 'Hàbitats',
	substrate: 'Tipus de fons',
	relief: 'Ombrejat del relleu',
	depthTint: 'Vel de fondària',
	coastline: 'Línia de costa',
	osmFeatures: 'Punts d’immersió i boies',
	annotations: 'Anotacions',
	interval: 'Interval',
	everyMetres: 'Cada {n} m',
	emphasised: 'Fondàries destacades',
	maxDepth: 'Fondària màxima',
	showLabels: 'Etiquetes de fondària',
	print: 'Imprimir',
	framing: 'Enquadrar full',
	framingHint: 'Arrossega el mapa. El requadre és el que s’imprimirà.',
	paper: 'Paper',
	scale: 'Escala',
	orientation: 'Orientació',
	portrait: 'Vertical',
	landscape: 'Horitzontal',
	exportPdf: 'Exportar PDF',
	language: 'Idioma',
	loading: 'Carregant el fons marí',
	offlineReady: 'Disponible sense connexió',
	saveArea: 'Desar aquesta zona',
	errorTitle: 'Alguna cosa no ha carregat',
	retry: 'Tornar-ho a provar',
	noSiteHere: 'Cap punt d’immersió en aquest enquadrament',
	editInOsm: 'Edita a OpenStreetMap',
	disclaimer: 'Per a orientació en immersió. No és una carta de navegació.',
	accuracyNote:
		'Els límits d’hàbitat són estimacions. La cartografia admet un 40 % d’encert per classe.',
	close: 'Tanca',
	maxDepthOf: 'Fondària màxima {n} m',
	difficulty: 'Dificultat',
	entryShore: 'Des de terra',
	entryBoat: 'Des de barca'
} as const;

type Catalogue = Record<keyof typeof ca, string>;

const es: Catalogue = {
	appName: 'Mapa de buceo',
	layers: 'Capas',
	isobaths: 'Isóbatas',
	ground: 'Fondo',
	habitats: 'Hábitats',
	substrate: 'Tipo de fondo',
	relief: 'Sombreado del relieve',
	depthTint: 'Velo de profundidad',
	coastline: 'Línea de costa',
	osmFeatures: 'Puntos de inmersión y boyas',
	annotations: 'Anotaciones',
	interval: 'Intervalo',
	everyMetres: 'Cada {n} m',
	emphasised: 'Profundidades destacadas',
	maxDepth: 'Profundidad máxima',
	showLabels: 'Etiquetas de profundidad',
	print: 'Imprimir',
	framing: 'Encuadrar hoja',
	framingHint: 'Arrastra el mapa. El recuadro es lo que se imprimirá.',
	paper: 'Papel',
	scale: 'Escala',
	orientation: 'Orientación',
	portrait: 'Vertical',
	landscape: 'Horizontal',
	exportPdf: 'Exportar PDF',
	language: 'Idioma',
	loading: 'Cargando el fondo marino',
	offlineReady: 'Disponible sin conexión',
	saveArea: 'Guardar esta zona',
	errorTitle: 'Algo no ha cargado',
	retry: 'Reintentar',
	noSiteHere: 'Ningún punto de inmersión en este encuadre',
	editInOsm: 'Editar en OpenStreetMap',
	disclaimer: 'Para orientación en inmersión. No es una carta de navegación.',
	accuracyNote:
		'Los límites de hábitat son estimaciones. La cartografía admite un 40 % de acierto por clase.',
	close: 'Cerrar',
	maxDepthOf: 'Profundidad máxima {n} m',
	difficulty: 'Dificultad',
	entryShore: 'Desde tierra',
	entryBoat: 'Desde barco'
};

const en: Catalogue = {
	appName: 'Dive map',
	layers: 'Layers',
	isobaths: 'Isobaths',
	ground: 'Bottom',
	habitats: 'Habitats',
	substrate: 'Seafloor type',
	relief: 'Relief shading',
	depthTint: 'Depth veil',
	coastline: 'Coastline',
	osmFeatures: 'Dive sites and buoys',
	annotations: 'Annotations',
	interval: 'Interval',
	everyMetres: 'Every {n} m',
	emphasised: 'Emphasised depths',
	maxDepth: 'Maximum depth',
	showLabels: 'Depth labels',
	print: 'Print',
	framing: 'Frame a sheet',
	framingHint: 'Drag the map. The box is what gets printed.',
	paper: 'Paper',
	scale: 'Scale',
	orientation: 'Orientation',
	portrait: 'Portrait',
	landscape: 'Landscape',
	exportPdf: 'Export PDF',
	language: 'Language',
	loading: 'Loading the seabed',
	offlineReady: 'Available offline',
	saveArea: 'Save this area',
	errorTitle: 'Something did not load',
	retry: 'Try again',
	noSiteHere: 'No dive site in this frame',
	editInOsm: 'Edit in OpenStreetMap',
	disclaimer: 'For dive orientation. Not a navigation chart.',
	accuracyNote: 'Habitat boundaries are estimates. The survey accepts 40% accuracy per class.',
	close: 'Close',
	maxDepthOf: 'Maximum depth {n} m',
	difficulty: 'Difficulty',
	entryShore: 'Shore entry',
	entryBoat: 'Boat entry'
};

export type MessageKey = keyof Catalogue;

const CATALOGUES: Record<Locale, Catalogue> = { ca, es, en };

export const t = (locale: Locale, key: MessageKey, values?: Record<string, number | string>): string => {
	const template = CATALOGUES[locale][key];
	if (values === undefined) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole));
};
