import type { Locale } from '$lib/i18n/locale';

/**
 * These belong in `$lib/i18n/messages.ts` beside the rest of the interface and
 * are only separate because this change was not allowed to write that file. The
 * shape is deliberately identical, so folding them in is a paste: Catalan is the
 * source of truth and the other two are typed against it, which is what turns a
 * missing translation into a compile error rather than a blank label on a boat.
 */

const ca = {
	myPosition: 'La meva posició',
	locating: 'Buscant senyal',
	tracking: 'Seguint la posició',
	positionOff: 'Posició desactivada',
	geoDenied: 'Permís denegat',
	geoDeniedHint: 'Activa la ubicació per a aquest lloc a la configuració del navegador.',
	geoUnavailable: 'Sense senyal GPS',
	geoUnavailableHint: 'Es torna a connectar sol quan el senyal torni.',
	geoTimeout: 'El GPS triga',
	geoTimeoutHint: 'Segueix provant-ho. L’última posició és la que es mostra.',
	geoUnsupported: 'Aquest navegador no dóna la posició',
	geoInsecure: 'Cal una connexió segura (https) per saber on ets.',
	accuracyM: 'Precisió ±{n} m',
	noFixYet: 'Encara sense posició',
	lastFixAgo: 'Última posició fa {n} s',
	recentre: 'Centrar a la meva posició',
	trail: 'Rastre',
	trailHint: 'Per on has passat. S’esvaeix cap a l’extrem més antic.',
	showTrail: 'Mostrar el rastre',
	trailWindow: 'Quant de rastre',
	windowMinutes: 'Últims {n} min',
	windowHours: 'Últimes {n} h',
	windowMetres: 'Últims {n} m',
	windowKm: 'Últims {n} km',
	trajectory: 'Rumb',
	showTrajectory: 'Mostrar el rumb',
	trajectoryHint: 'Cap on va la barca, calculat pel moviment i no per l’orientació del mòbil.',
	courseReading: '{deg}° · {kn} nusos',
	courseStationary: 'Aturat, sense rumb',
	avatarGroup: 'Figura',
	avatarPirateBoat: 'Vaixell pirata',
	avatarLlagut: 'Llagut',
	avatarZodiac: 'Zodiac',
	avatarShip: 'Barca d’immersió',
	avatarTurtle: 'Tortuga babaua',
	avatarRay: 'Milana',
	avatarGrouper: 'Nero',
	avatarOctopus: 'Pop'
} as const;

type Catalogue = Record<keyof typeof ca, string>;

const es: Catalogue = {
	myPosition: 'Mi posición',
	locating: 'Buscando señal',
	tracking: 'Siguiendo la posición',
	positionOff: 'Posición desactivada',
	geoDenied: 'Permiso denegado',
	geoDeniedHint: 'Activa la ubicación para este sitio en los ajustes del navegador.',
	geoUnavailable: 'Sin señal GPS',
	geoUnavailableHint: 'Se vuelve a conectar solo cuando la señal regrese.',
	geoTimeout: 'El GPS tarda',
	geoTimeoutHint: 'Sigue intentándolo. Se muestra la última posición.',
	geoUnsupported: 'Este navegador no da la posición',
	geoInsecure: 'Hace falta una conexión segura (https) para saber dónde estás.',
	accuracyM: 'Precisión ±{n} m',
	noFixYet: 'Todavía sin posición',
	lastFixAgo: 'Última posición hace {n} s',
	recentre: 'Centrar en mi posición',
	trail: 'Rastro',
	trailHint: 'Por dónde has pasado. Se desvanece hacia el extremo más antiguo.',
	showTrail: 'Mostrar el rastro',
	trailWindow: 'Cuánto rastro',
	windowMinutes: 'Últimos {n} min',
	windowHours: 'Últimas {n} h',
	windowMetres: 'Últimos {n} m',
	windowKm: 'Últimos {n} km',
	trajectory: 'Rumbo',
	showTrajectory: 'Mostrar el rumbo',
	trajectoryHint: 'Hacia dónde va la barca, calculado por el movimiento y no por la orientación del móvil.',
	courseReading: '{deg}° · {kn} nudos',
	courseStationary: 'Parado, sin rumbo',
	avatarGroup: 'Figura',
	avatarPirateBoat: 'Barco pirata',
	avatarLlagut: 'Llagut',
	avatarZodiac: 'Zodiac',
	avatarShip: 'Barca de buceo',
	avatarTurtle: 'Tortuga boba',
	avatarRay: 'Águila marina',
	avatarGrouper: 'Mero',
	avatarOctopus: 'Pulpo'
};

const en: Catalogue = {
	myPosition: 'My position',
	locating: 'Looking for a fix',
	tracking: 'Following your position',
	positionOff: 'Position off',
	geoDenied: 'Permission denied',
	geoDeniedHint: 'Allow location for this site in your browser settings.',
	geoUnavailable: 'No GPS signal',
	geoUnavailableHint: 'It reconnects on its own once the signal comes back.',
	geoTimeout: 'The GPS is slow',
	geoTimeoutHint: 'Still trying. The last position is the one shown.',
	geoUnsupported: 'This browser will not give a position',
	geoInsecure: 'Finding you needs a secure (https) connection.',
	accuracyM: 'Accurate to ±{n} m',
	noFixYet: 'No position yet',
	lastFixAgo: 'Last position {n} s ago',
	recentre: 'Centre on my position',
	trail: 'Trail',
	trailHint: 'Where you came from. It fades out towards the oldest end.',
	showTrail: 'Show the trail',
	trailWindow: 'How much trail',
	windowMinutes: 'Last {n} min',
	windowHours: 'Last {n} h',
	windowMetres: 'Last {n} m',
	windowKm: 'Last {n} km',
	trajectory: 'Course',
	showTrajectory: 'Show the course',
	trajectoryHint: 'Where the boat is going, worked out from its movement rather than the phone’s orientation.',
	courseReading: '{deg}° · {kn} kn',
	courseStationary: 'Stopped, no course',
	avatarGroup: 'Figure',
	avatarPirateBoat: 'Pirate ship',
	avatarLlagut: 'Llagut',
	avatarZodiac: 'Zodiac',
	avatarShip: 'Dive boat',
	avatarTurtle: 'Loggerhead turtle',
	avatarRay: 'Eagle ray',
	avatarGrouper: 'Dusky grouper',
	avatarOctopus: 'Octopus'
};

export type GeoKey = keyof Catalogue;

const CATALOGUES: Record<Locale, Catalogue> = { ca, es, en };

export const gt = (
	locale: Locale,
	key: GeoKey,
	values?: Record<string, number | string>
): string => {
	const template = CATALOGUES[locale][key];
	if (values === undefined) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole));
};
