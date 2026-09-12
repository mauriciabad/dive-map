import { asset } from '$app/paths';
import type { AvatarId } from './avatars.ts';

/**
 * Separate from the catalogue so the catalogue stays importable in node, where
 * `avatars.spec.ts` checks it against what the build script actually drew.
 *
 * Spelled out one literal at a time because `asset()` resolves a known static
 * file, which is also what makes a drawing that never shipped a build error.
 */
const FILES: Readonly<Record<AvatarId, string>> = {
	'pirate-boat': asset('/avatars/pirate-boat.png'),
	llagut: asset('/avatars/llagut.png'),
	zodiac: asset('/avatars/zodiac.png'),
	ship: asset('/avatars/ship.png'),
	turtle: asset('/avatars/turtle.png'),
	ray: asset('/avatars/ray.png'),
	grouper: asset('/avatars/grouper.png'),
	octopus: asset('/avatars/octopus.png')
};

export const avatarUrl = (id: AvatarId): string => FILES[id];
