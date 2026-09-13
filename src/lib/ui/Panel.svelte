<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { MediaQuery } from 'svelte/reactivity';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import type { PanelAnchor } from './panel';
	import {
		type DragSample,
		type Detent,
		MIN_DRAG_PX,
		followPointer,
		settle,
		velocityOf
	} from './sheet';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * Every panel in the app is this one. A phone gets a sheet across the bottom
	 * that a thumb can drag down to close; anything wider, and a phone on its
	 * side, gets a column anchored beside the corner stack it belongs to. Both
	 * scroll inside themselves, so no panel can run off the screen and no caller
	 * gets to choose its own width, padding or position.
	 *
	 * The sheet rests short of the map centre on purpose: the print crop is drawn
	 * there, and a sheet over it cannot be framed. Dragging up raises it.
	 */

	interface Props {
		readonly title: string;
		readonly locale: Locale;
		readonly onclose: () => void;
		/** Which corner stack the desktop column hangs off. */
		readonly anchor?: PanelAnchor;
		/**
		 * A section heading is set in caps; a place name is not, because a Catalan
		 * name in caps is measurably harder to read and the map's names are the
		 * point.
		 */
		readonly titleTone?: 'label' | 'name';
		/**
		 * The mark the map draws for what the panel is about, in the map's own colour
		 * for it. A diver who tapped a yellow can buoy should see that buoy on the
		 * card, not read the word for it.
		 */
		readonly icon?: IconName | undefined;
		readonly iconTint?: string | undefined;
		/**
		 * Names what the panel is showing, for a panel that swaps its whole contents.
		 * Changing it puts the scroll back to the top, because arriving halfway down a
		 * screen you have never seen, with the way back above the fold, is how a panel
		 * loses somebody.
		 */
		readonly showing?: string;
		/** Needed when the button that opens the panel lives in another subtree. */
		readonly id?: string;
		/** Pinned under the scroll area: the one action the panel exists to run. */
		readonly footer?: Snippet;
		readonly children: Snippet;
	}

	const {
		title,
		locale,
		onclose,
		anchor = 'top-left',
		titleTone = 'label',
		icon,
		iconTint,
		showing,
		id,
		footer,
		children
	}: Props = $props();

	const narrow = new MediaQuery('max-width: 47.999rem');
	const short = new MediaQuery('max-height: 30rem');
	const asSheet = $derived(narrow.current && !short.current);

	let detent = $state<Detent>('rest');
	let dragPx = $state(0);
	let dragging = $state(false);
	let heightPx = $state(0);
	let overflowing = $state(false);

	/** Only ever read from a pointer handler, so it does not need to be reactive. */
	let panel: HTMLElement | undefined;
	let startY = 0;
	let travelled = 0;
	let samples: DragSample[] = [];

	const holdPanel = (node: HTMLElement) => {
		panel = node;
		return () => {
			panel = undefined;
		};
	};

	/** The grip, which is what a pointer is captured to for the length of a drag. */
	type GripEvent = PointerEvent & { readonly currentTarget: EventTarget & HTMLElement };

	/** While a drag is going up the sheet grows under the thumb rather than after it. */
	const shown = $derived<Detent>(dragging && dragPx < 0 ? 'raised' : detent);
	const fromPct = $derived(heightPx > 0 ? Math.min(100, (dragPx / heightPx) * 100) : 0);

	const start = (event: GripEvent): void => {
		if (!asSheet || event.button !== 0 || panel === undefined) return;
		heightPx = panel.getBoundingClientRect().height;
		startY = event.clientY;
		travelled = 0;
		samples = [{ y: event.clientY, at: event.timeStamp }];
		dragging = true;
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const move = (event: PointerEvent): void => {
		if (!dragging) return;
		samples = [...samples, { y: event.clientY, at: event.timeStamp }].slice(-4);
		travelled = Math.max(travelled, Math.abs(event.clientY - startY));
		dragPx = followPointer(event.clientY - startY);
	};

	const finish = (event: GripEvent): void => {
		if (!dragging) return;
		dragging = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
		const result = settle(detent, {
			offsetPx: event.clientY - startY,
			heightPx,
			velocityPxPerMs: velocityOf(samples)
		});
		detent = result.detent;
		if (result.dismissed) {
			onclose();
			return;
		}
		dragPx = 0;
	};

	/**
	 * The fade only appears over a list that really does continue, and it is
	 * driven by the live scroll position rather than painted over a whole one.
	 * Children are observed too: a panel section can grow without the scroller
	 * itself changing size.
	 */
	let body = $state<HTMLElement | undefined>(undefined);

	$effect(() => {
		if (showing === undefined) return;
		body?.scrollTo({ top: 0 });
	});

	const fadeWhenCut = (node: HTMLElement) => {
		body = node;
		const measure = (): void => {
			overflowing = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
		};
		const watcher = new ResizeObserver(measure);
		watcher.observe(node);
		for (const child of Array.from(node.children)) watcher.observe(child);
		node.addEventListener('scroll', measure, { passive: true });
		measure();
		return () => {
			body = undefined;
			node.removeEventListener('scroll', measure);
			watcher.disconnect();
		};
	};

	/** A drag that ended on the grip must not also read as a press on it. */
	const press = (): void => {
		if (travelled > MIN_DRAG_PX) return;
		detent = detent === 'raised' ? 'rest' : 'raised';
	};

	const reveal = (_node: Element, options: { readonly sheet: boolean; readonly from: number }) => {
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!options.sheet) {
			return {
				duration: still ? 0 : 170,
				easing: cubicOut,
				css: (progress: number) => `opacity: ${progress}; translate: 0 ${(1 - progress) * -8}px`
			};
		}
		const from = options.from;
		return {
			duration: still ? 0 : Math.round(280 * (1 - from / 100)),
			easing: cubicOut,
			css: (_progress: number, remaining: number) =>
				`translate: 0 ${from + remaining * (100 - from)}%`
		};
	};
</script>

<svelte:window
	onkeydown={(event: KeyboardEvent) => {
		if (event.key === 'Escape') onclose();
	}}
/>

<section
	{id}
	class={['panel', { dragging }]}
	data-anchor={anchor}
	data-detent={shown}
	style:--drag-y="{dragPx}px"
	aria-label={title}
	transition:reveal={{ sheet: asSheet, from: fromPct }}
	{@attach holdPanel}
>
	<header>
		<button
			type="button"
			class="grab"
			aria-label={title}
			aria-expanded={shown === 'raised'}
			onpointerdown={start}
			onpointermove={move}
			onpointerup={finish}
			onpointercancel={finish}
			onclick={press}
		></button>
		{#if icon !== undefined}
			<span class="mark" style:color={iconTint ?? 'var(--color-brass-300)'}>
				<Icon name={icon} size={26} />
			</span>
		{/if}
		<h2 data-tone={titleTone}>{title}</h2>
		<button type="button" class="close" onclick={onclose}>
			<Icon name="close" size={22} />
			<span class="visually-hidden">{t(locale, 'close')}</span>
		</button>
	</header>

	<div class={['body', { overflowing }]} {@attach fadeWhenCut}>
		{@render children()}
	</div>

	{#if footer !== undefined}
		<div class="foot">{@render footer()}</div>
	{/if}
</section>

<style>
	.panel {
		position: fixed;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		inset: auto 0 0 0;
		max-height: 46svh;
		padding-block: 0.35rem 0;
		padding-inline: max(var(--panel-pad), env(safe-area-inset-left))
			max(var(--panel-pad), env(safe-area-inset-right));
		padding-bottom: calc(0.6rem + env(safe-area-inset-bottom));
		background: var(--panel-face);
		border: 1px solid var(--ctrl-edge);
		border-bottom: 0;
		border-radius: var(--radius-rail) var(--radius-rail) 0 0;
		box-shadow: var(--rail-shadow);
		translate: 0 var(--drag-y, 0px);
		transition:
			translate 240ms cubic-bezier(0.2, 0.9, 0.3, 1),
			max-height 240ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}

	.panel[data-detent='raised'] {
		max-height: 84svh;
	}

	.panel.dragging {
		transition: max-height 240ms cubic-bezier(0.2, 0.9, 0.3, 1);
		user-select: none;
	}

	/*
	 * Wide enough for a column, or too short for a sheet, and the panel hangs off
	 * the corner stack that opens it instead. The drag gesture switches off with
	 * the sheet, so a mouse never nudges a column halfway down the screen.
	 */
	@media (min-width: 48rem), (max-height: 30rem) {
		.panel {
			--reach: calc(100svh - var(--ctrl-inset-top) - var(--ctrl-inset-bottom));
			inset: var(--ctrl-inset-top) auto auto var(--ctrl-inset-left);
			width: min(var(--panel-width), calc(100vw - var(--ctrl-inset-left) - var(--ctrl-gap)));
			max-height: var(--reach);
			padding: 0.35rem var(--panel-pad) 0.7rem;
			border: 1px solid var(--ctrl-edge);
			border-radius: var(--radius-rail);
			translate: none;
		}

		.panel[data-anchor='top-right'] {
			inset: var(--ctrl-inset-top) var(--ctrl-inset-right) auto auto;
			width: min(var(--panel-width), calc(100vw - var(--ctrl-inset-right) - var(--ctrl-gap)));
		}

		.panel[data-anchor='bottom-left'] {
			inset: auto auto var(--ctrl-inset-bottom) calc(env(safe-area-inset-left) + var(--ctrl-gap));
			max-height: min(var(--reach) - 4 * var(--ctrl-size), 32rem);
		}

		.grab {
			display: none;
		}

		header {
			min-height: 0;
		}
	}

	header {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex: none;
		min-height: var(--spacing-touch);
	}

	/*
	 * The whole header is what a thumb pulls, not a 4px pill, so the drag target
	 * is the full width of the sheet and taller than the touch floor. The title
	 * sits on top of it and lets pointer events through; the close button does
	 * not, so pressing it closes rather than starting a drag.
	 */
	.grab {
		position: absolute;
		inset: -0.35rem -0.5rem 0;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		cursor: grab;
		touch-action: none;
	}

	.grab::before {
		content: '';
		position: absolute;
		inset: 0.45rem auto auto 50%;
		translate: -50% 0;
		width: 2.5rem;
		height: 0.25rem;
		border-radius: 999px;
		background: var(--color-table-500);
	}

	.panel.dragging .grab {
		cursor: grabbing;
	}

	/* Over the grab handle, and letting the drag through it. */
	.mark {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		pointer-events: none;
	}

	h2 {
		position: relative;
		pointer-events: none;
		margin: 0 auto 0 0;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-brass-300);
		overflow-wrap: anywhere;
	}

	h2[data-tone='name'] {
		font-size: 1.15rem;
		text-transform: none;
	}

	.close {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--spacing-touch);
		height: var(--spacing-touch);
		margin-right: -0.55rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink-dim);
		cursor: pointer;
		transition: color var(--control-ease);
	}

	.close:hover {
		background: var(--control-hover);
		color: var(--control-ink);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--panel-gap);
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-block: 0.35rem;
	}

	.body.overflowing {
		mask-image: linear-gradient(180deg, #000 calc(100% - 1.6rem), transparent);
	}

	.foot {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		flex: none;
		padding-top: 0.55rem;
	}
</style>
