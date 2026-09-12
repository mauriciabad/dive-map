import type { GeoKey } from './messages.ts';

/**
 * The thing that marks where you are. A blue dot is what every other map does,
 * and on a boat it is also the least useful shape available: it cannot show
 * which way you are pointing.
 *
 * Every figure is drawn bow-up, so `icon-rotate` takes a course in degrees
 * clockwise from north with no offset anywhere. Each carries a dark halo under a
 * pale fill, which is the pair that survives both grounds this map draws: the
 * halo holds the figure together over the pale shallows, the pale fill holds it
 * over the deep water veil.
 */

export const AVATARS = [
	/** The default, because the user asked for it and a dive boat is allowed to be fun. */
	{ id: 'pirate-boat', key: 'avatarPirateBoat' },
	/** The lateen-rigged hull that actually belongs to this coast, and still fishes it. */
	{ id: 'llagut', key: 'avatarLlagut' },
	/** The RIB most Costa Brava dive centres really launch from. The honest option. */
	{ id: 'zodiac', key: 'avatarZodiac' },
	/** Top-down motor launch with a wheelhouse and an aft dive platform. */
	{ id: 'ship', key: 'avatarShip' },
	/** Caretta caretta, which nests and feeds along this coast. */
	{ id: 'turtle', key: 'avatarTurtle' },
	/** An eagle ray over the sand flats: a diamond reads its heading at any size. */
	{ id: 'ray', key: 'avatarRay' },
	/** The nero of the Medes, the fish most divers on this coast came to see. */
	{ id: 'grouper', key: 'avatarGrouper' },
	/** Pop. Radial, unmistakable from above, and on every menu in every port. */
	{ id: 'octopus', key: 'avatarOctopus' }
] as const satisfies readonly { readonly id: string; readonly key: GeoKey }[];

export type AvatarId = (typeof AVATARS)[number]['id'];

export const DEFAULT_AVATAR: AvatarId = 'pirate-boat';

export const isAvatarId = (value: string): value is AvatarId =>
	AVATARS.some((a) => a.id === value);

/**
 * Rasterised at 256 px and registered at pixelRatio 4, so the sprite is 64 CSS
 * px at `icon-size` 1 and still has detail left on a 3x phone screen.
 */
export const AVATAR_PIXEL_RATIO = 4;
