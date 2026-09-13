<script lang="ts">
	import Icon from './Icon.svelte';
	import { formatAddress } from '$lib/state/address';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	/**
	 * Hand somebody the water on screen.
	 *
	 * Its own slab under the settings rail rather than a seventh button in it. The
	 * rail is six ways of drawing the map and this sends the map somewhere, which
	 * is a different act; and a group of its own is what lets the copied pill sit
	 * beside the button, since every control group clips to its rounded corners.
	 *
	 * In the map chrome rather than on the feature card or the print panel, which
	 * were the other two candidates. The fragment already carries the camera and
	 * the open card both, so one button out here sends whichever of the two the
	 * diver is looking at, and it is on screen from anywhere instead of behind a
	 * panel that has to be opened first.
	 */

	interface Props {
		readonly view: MapState;
	}

	const { view }: Props = $props();

	/** Long enough to read four syllables on a deck, short enough not to linger. */
	const COPIED_SHOWN_MS = 2400;

	let copied = $state(false);
	let clearing: ReturnType<typeof setTimeout> | undefined;

	/**
	 * The link for what is on screen, built from the live camera rather than read
	 * off the address bar. The bar trails the map by 400 ms, and a diver who pans
	 * onto the site and shares in one movement would otherwise send where they
	 * had just been.
	 */
	const link = (): string => {
		const query = formatAddress(
			{ camera: view.camera, osm: view.selection?.feature?.ref },
			location.search
		);
		return `${location.origin}${location.pathname}${query}`;
	};

	/**
	 * True once the browser's own sharing sheet has the link, which is what every
	 * phone does and what the owner asked for.
	 *
	 * A cancelled sheet counts as handled. The diver said no, and dropping the
	 * link on their clipboard behind that no would be answering a question they
	 * had just declined. Any other failure counts as no sheet at all and falls
	 * through to the clipboard, which is the desktop path.
	 */
	const handedToTheSheet = async (url: string): Promise<boolean> => {
		if (typeof navigator.share !== 'function') return false;
		try {
			await navigator.share({ title: t(view.locale, 'appName'), url });
			return true;
		} catch (error) {
			return error instanceof DOMException && error.name === 'AbortError';
		}
	};

	const send = async (): Promise<void> => {
		const url = link();
		if (await handedToTheSheet(url)) return;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			return;
		}
		copied = true;
		clearTimeout(clearing);
		clearing = setTimeout(() => {
			copied = false;
		}, COPIED_SHOWN_MS);
	};

	$effect(() => () => {
		clearTimeout(clearing);
	});
</script>

<button
	type="button"
	title={t(view.locale, 'share')}
	onclick={() => {
		void send();
	}}
>
	<Icon name="share" size={22} />
	<span class="visually-hidden">{t(view.locale, 'share')}</span>
</button>

<!--
	Rendered always rather than behind an `{#if}`, so a screen reader has the live
	region on the page before the text lands in it. Deaf to the pointer, like the
	loading pill: a drag that starts on it still pans the map.
-->
<p class="copied" role="status" aria-live="polite" data-shown={copied}>
	{copied ? t(view.locale, 'shareCopied') : ''}
</p>

<style>
	.copied {
		position: absolute;
		z-index: 1;
		top: 50%;
		left: calc(100% + 0.45rem);
		translate: 0 -50%;
		margin: 0;
		width: max-content;
		padding: 0.4rem 0.7rem;
		border-radius: var(--radius-rail);
		background: var(--color-table-800);
		box-shadow: var(--rail-shadow);
		color: var(--color-paper);
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
		pointer-events: none;
		transition: opacity 160ms ease-out;
	}

	.copied[data-shown='false'] {
		opacity: 0;
	}
</style>
