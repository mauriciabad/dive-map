import {
	type BaseMapId,
	type BaseMapKind,
	NO_BASE_MAP,
	type QuickPair,
	baseMapOf
} from '$lib/domain/basemaps';
import type { Locale } from '$lib/i18n/locale';
import { type MessageKey, t } from '$lib/i18n/messages';

/**
 * What to call a base map out loud.
 *
 * The archives' names are proper nouns and are never translated. Only the shelf
 * they sit on is, so the name is the shelf and then the archive: Satellite
 * Costa, Classic IGN. Three places say it, the picker's shelf headings, the
 * corner button naming where it is about to take you, and the quick pair's
 * summary, and they have to say it the same way or the panel is describing a
 * different map from the one the button swaps to.
 */

const KIND_KEY: Record<BaseMapKind, MessageKey> = {
	satellite: 'baseMapSatellite',
	standard: 'baseMapStandard',
	classic: 'baseMapClassic'
};

/** The shelf on its own, for a heading over the archives that sit on it. */
export const baseMapKindName = (kind: BaseMapKind, locale: Locale): string =>
	t(locale, KIND_KEY[kind]);

export const baseMapName = (id: BaseMapId, locale: Locale): string => {
	const map = id === NO_BASE_MAP ? undefined : baseMapOf(id);
	if (map === undefined) return t(locale, 'baseMapNone');
	return `${baseMapKindName(map.kind, locale)} ${map.name}`;
};

/** Both maps the corner button flicks between, resting one first. */
export const quickPairName = (pair: QuickPair, locale: Locale): string =>
	pair.map((id) => baseMapName(id, locale)).join(' · ');
