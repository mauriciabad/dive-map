import {
	type Ground,
	type SeabedClass,
	type TextureChoices,
	byProminence,
	catalogueOf,
	seabedClassByCode,
	seabedKey,
	textureOf
} from '$lib/domain/habitat';
import {
	PATTERN_CSS_SIZE,
	type TextureFormat,
	type TextureSize,
	textureUrl
} from '$lib/map/textures';
import type { TextureSample } from './controls/types';

/**
 * What the legend panel shows, worked out away from the markup.
 *
 * Thirty-one textures carry fifty-three classes, so the legend is keyed by
 * texture rather than by class: a diver looking at a patch of seabed asks what
 * that pattern means, and six classes share `metal`. Every class of the ground's
 * catalogue is listed either way, because a legend that only names what happens
 * to be on screen cannot answer what the next headland is painted with.
 *
 * Rows group by the texture a class is painted with now, not by the one the
 * catalogue gives it, so choosing a texture for one class moves it out of the row
 * it shared and into the row it now belongs to. That regrouping is the legend
 * telling the truth about what the pixels do.
 */

export interface LegendEntry {
	/** Unique across both catalogues, which reuse raster numbers. */
	readonly key: string;
	readonly seabed: SeabedClass;
	/** Only the habitat catalogue carries one; lifted here so the markup never narrows the union. */
	readonly hic: string | undefined;
	/** True when the diver chose this class's texture rather than taking the catalogue's. */
	readonly chosen: boolean;
}

export interface LegendRow {
	readonly texture: string;
	/** Painted with this texture somewhere in the frame, most diver-relevant first. */
	readonly inFrame: readonly LegendEntry[];
	/** Painted with this texture on the map but not in the frame. Same order. */
	readonly elsewhere: readonly LegendEntry[];
}

export interface Legend {
	/** Rows with at least one class in the frame. */
	readonly inFrame: readonly LegendRow[];
	/** Every remaining texture of the ground's catalogue, once each. */
	readonly elsewhere: readonly LegendRow[];
}

interface Draft {
	readonly inFrame: LegendEntry[];
	readonly elsewhere: LegendEntry[];
}

const entryOf = (seabed: SeabedClass, chosen: TextureChoices): LegendEntry => ({
	key: seabedKey(seabed),
	seabed,
	hic: 'hic' in seabed ? seabed.hic : undefined,
	chosen: chosen[seabedKey(seabed)] !== undefined
});

const draftAt = (rows: Map<string, Draft>, texture: string): Draft => {
	const found = rows.get(texture);
	if (found !== undefined) return found;
	const fresh: Draft = { inFrame: [], elsewhere: [] };
	rows.set(texture, fresh);
	return fresh;
};

export const buildLegend = (
	ground: Ground,
	present: ReadonlySet<string>,
	chosen: TextureChoices
): Legend => {
	const own = catalogueOf(ground);
	const entries = own.map((seabed) => entryOf(seabed, chosen));
	// Each layer returns a few codes only the other catalogue defines, and the style
	// really does paint them. A code the ground's own catalogue claims keeps the
	// ground's meaning, as patternFor does.
	const claimed = new Set(own.map((seabed) => seabed.code));
	for (const code of present) {
		if (claimed.has(code)) continue;
		const seabed = seabedClassByCode(code, ground);
		if (seabed !== undefined) entries.push(entryOf(seabed, chosen));
	}
	entries.sort((a, b) => byProminence(a.seabed, b.seabed));

	const isHere = (entry: LegendEntry): boolean => present.has(entry.seabed.code);

	// Two passes over the sorted entries: the first fixes the row order by the best
	// class each texture has on screen, the second fills the rows.
	const rows = new Map<string, Draft>();
	for (const entry of entries) {
		if (isHere(entry)) draftAt(rows, textureOf(entry.seabed, chosen));
	}
	for (const entry of entries) {
		const draft = draftAt(rows, textureOf(entry.seabed, chosen));
		(isHere(entry) ? draft.inFrame : draft.elsewhere).push(entry);
	}

	const built: readonly LegendRow[] = [...rows].map(([texture, draft]) => ({ texture, ...draft }));
	return {
		inFrame: built.filter((row) => row.inFrame.length > 0),
		elsewhere: built.filter((row) => row.inFrame.length === 0)
	};
};

/** Narrows the untyped `code` off rendered ground features. */
export const codesOf = (
	features: readonly { readonly properties: Readonly<Record<string, unknown>> }[]
): ReadonlySet<string> => {
	const codes = new Set<string>();
	for (const feature of features) {
		const code = feature.properties['code'];
		if (typeof code === 'string') codes.add(code);
	}
	return codes;
};

/** The map's own file at the map's own repeat, which is what makes the band honest. */
export const sampleFor = (
	texture: string,
	size: TextureSize,
	format: TextureFormat
): TextureSample => ({ url: textureUrl(texture, size, format), repeatCssPx: PATTERN_CSS_SIZE });
