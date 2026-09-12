/**
 * Font stacks for the map, keyed by the role each one plays.
 *
 * Each string does three jobs at once. It names a directory under static/fonts/ that the
 * glyph build script emits, it is the {fontstack} token MapLibre substitutes into the glyphs
 * URL when it requests SDF ranges, and it is the family name the CSS asks for. The names come
 * from each font's own internal name table. An edit here still builds, then glyphs stop
 * loading at runtime.
 */
export const MAP_FONT = {
	label: 'Alegreya Sans Bold',
	secondary: 'Alegreya Sans Regular',
	title: 'Alegreya Bold'
} as const;

export type MapFontStack = (typeof MAP_FONT)[keyof typeof MAP_FONT];

export const MAP_FONT_STACKS: readonly MapFontStack[] = Object.values(MAP_FONT);
