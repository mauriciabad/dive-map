import type { Localised } from '$lib/domain/habitat';
import type { IconName } from '$lib/ui/icons';

/**
 * The ICGC habitat survey's point records, which are the half of that delivery
 * this map never drew.
 *
 * `HABITATS_HABITATS_MARINS` is the polygon layer the seabed is painted from.
 * `HABITATS_MARINS_COM` carries the same attributes over single points: 1,392
 * places where the survey found standing life too small to hold a polygon at its
 * own scale. Three of the four classes are gorgonian grounds and the fourth is an
 * invasive alga, so every one of them is something a diver goes looking for or
 * wants to know about before they do.
 *
 * These are EUNIS level 5, two digits finer than anything in the polygon
 * catalogue: `CODI_LPRE3` is "-" on every record, so `CODI_LPRE4` is the only
 * join key, and it is what `pipeline/scripts/build_habitat_points.py` writes out
 * as `code`.
 *
 * Colour is the family and the drawing is the kind, the same rule `markers.ts`
 * follows, and there is one family: something alive that the survey singled out.
 * The drawing is what separates a fan of Paramuricea from a runner of Caulerpa,
 * because at 20 px a silhouette carries further than a hue does.
 */

export interface HabitatPointClass extends Localised {
	/** CODI_LPRE4, and what the built GeoJSON carries as `code`. */
	readonly code: string;
	readonly icon: IconName;
	readonly colour: string;
	/** Habitat of Community Interest code, where the class has one. */
	readonly hic: string | undefined;
}

/**
 * The one ink the whole layer is drawn in.
 *
 * Chartreuse because it is the last high-contrast hue on this map nothing else
 * owns. The chart marks have taken cream, amber, hazard orange, regulation
 * magenta, beacon yellow and shore teal, and the depth ramp in
 * `$lib/domain/isobaths` has taken the rest of the wheel one band at a time:
 * 40 to 49 m is `#c9a0ff`, which is where most of these records are, so a violet
 * mark sat on the exact contour that shares its colour. Green also says living
 * cover, which is what every one of these four classes is.
 */
const LIVING = '#c3f53f';

/**
 * In the order a diver reads them, which here is how much of the coast each one
 * accounts for. 1,259 records of Paramuricea against two of Caulerpa.
 */
export const HABITAT_POINTS: readonly HabitatPointClass[] = [
	{
		code: '302022501',
		ca: 'Coral·ligen amb Paramuricea clavata',
		es: 'Coralígeno con Paramuricea clavata',
		en: 'Coralligenous with Paramuricea clavata',
		icon: 'pointGorgonianFan',
		colour: LIVING,
		hic: '1170'
	},
	{
		code: '302022301',
		ca: 'Roca circalitoral amb Leptogorgia sarmentosa i Eunicella verrucosa',
		es: 'Roca circalitoral con Leptogorgia sarmentosa y Eunicella verrucosa',
		en: 'Circalittoral rock with Leptogorgia sarmentosa and Eunicella verrucosa',
		icon: 'pointGorgonianSparse',
		colour: LIVING,
		hic: '1170'
	},
	{
		code: '301041407',
		ca: 'Roca infralitoral amb Eunicella singularis',
		es: 'Roca infralitoral con Eunicella singularis',
		en: 'Infralittoral rock with Eunicella singularis',
		icon: 'pointGorgonianWhip',
		colour: LIVING,
		hic: '1170'
	},
	{
		code: '305130202',
		ca: 'Herbeis de Caulerpa cylindracea',
		es: 'Praderas de Caulerpa cylindracea',
		en: 'Caulerpa cylindracea beds',
		icon: 'pointCaulerpa',
		colour: LIVING,
		hic: undefined
	}
];

/** MapLibre image id for a class's glyph. */
export const habitatPointImageId = (code: string): string => `habitat-point-${code}`;

/** Every image the habitat point layer asks for by name. */
export const HABITAT_POINT_IMAGES: readonly {
	readonly id: string;
	readonly icon: IconName;
}[] = HABITAT_POINTS.map(({ code, icon }) => ({ id: habitatPointImageId(code), icon }));

/**
 * The zoom the points start drawing at.
 *
 * The same question `MARKERS.from` answers, and the same reasoning. Below this
 * the whole survey is in one frame and 1,259 coralligenous records stack into a
 * mat along two hundred kilometres of coast, which says nothing a diver can use.
 * Ten is where a frame holds one stretch of coast, so the spread that survives
 * collision is where the gorgonian grounds are.
 */
export const HABITAT_POINT_FROM = 10;

/**
 * Placement order when two points want the same pixels: the rarest class first.
 *
 * MapLibre places the lowest sort key first and a placed symbol holds its pixels
 * against everything after it. Without this the 1,259 Paramuricea records would
 * bury the two Caulerpa ones at every zoom the layer draws at. The table above is
 * written most abundant first, because that is the order a legend reads in, so
 * this is its reverse.
 */
export const HABITAT_POINT_SORT: Readonly<Record<string, number>> = Object.fromEntries(
	HABITAT_POINTS.map(({ code }, at) => [code, HABITAT_POINTS.length - at])
);
