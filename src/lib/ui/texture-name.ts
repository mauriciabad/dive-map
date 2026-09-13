/**
 * What to call a texture on a button.
 *
 * The ids are basenames in the Crosshead pack, so they are not translated and
 * they never will be: there are 21 of them today and the point of the build step
 * is that there can be many more, which rules out a hand-written label per
 * texture in three languages.
 *
 * The band above the label is the real answer to "which one is this". The label
 * is what makes four grey rocks tellable apart once you have narrowed it down,
 * and it is the only thing a screen reader has.
 */
export const textureName = (texture: string): string => {
	const words = texture.replace(/^ch_/, '').replaceAll('_', ' ').trim();
	if (words.length === 0) return texture;
	return words.charAt(0).toUpperCase() + words.slice(1);
};
