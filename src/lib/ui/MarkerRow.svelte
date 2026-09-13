<script lang="ts">
	import Mark from './Mark.svelte';
	import { KIND_LABEL } from './feature-card';
	import type { DiveFeatureKind } from '$lib/domain/osm';
	import { MARKERS } from '$lib/map/markers';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * One kind of marker: the mark exactly as the map draws it, what it is called,
	 * and a switch. The legend and the switch are the same row on purpose. A diver
	 * who has just worked out what the magenta circle means is one tap from
	 * turning every one of them off.
	 *
	 * A harbour has no mark, so the row shows its name in the map's own label
	 * style. That is the whole answer to what a harbour looks like out there.
	 */

	interface Props {
		readonly kind: DiveFeatureKind;
		readonly locale: Locale;
		readonly on: boolean;
		readonly onchange: () => void;
	}

	const { kind, locale, on, onchange }: Props = $props();

	const style = $derived(MARKERS[kind]);
</script>

<button type="button" class="row" aria-pressed={on} onclick={onchange}>
	<span class="mark">
		{#if style.icon !== undefined}
			<Mark icon={style.icon} tint={style.colour} plate={style.plate} />
		{/if}
	</span>
	<span class="name" data-label-only={style.icon === undefined} style:--ink={style.colour}>
		{t(locale, KIND_LABEL[kind])}
	</span>
	<span class="pip" aria-hidden="true"></span>
</button>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		min-height: var(--spacing-touch);
		padding: 0.3rem 0.5rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--control-ease);
	}

	.row:hover {
		background: var(--control-hover);
	}

	.row[aria-pressed='false'] .mark,
	.row[aria-pressed='false'] .name {
		opacity: 0.4;
	}

	/* The width is held whether or not there is a mark in it, so the names line up. */
	.mark {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
	}

	.name {
		flex: 1;
		min-width: 0;
		font-size: var(--control-text);
		overflow-wrap: anywhere;
	}

	/* What the map actually paints for a kind it only names: cream on dark. */
	.name[data-label-only='true'] {
		color: var(--ink);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-shadow:
			0 0 3px var(--color-table-900),
			0 0 3px var(--color-table-900);
	}

	.pip {
		flex: none;
		position: relative;
		width: 2.3rem;
		height: 1.25rem;
		border-radius: 999px;
		background: var(--color-table-600);
		box-shadow: var(--sunk);
		transition: background 160ms ease-out;
	}

	.pip::after {
		content: '';
		position: absolute;
		inset: 2px auto 2px 2px;
		width: 1.05rem;
		border-radius: 999px;
		background: var(--control-ink-dim);
		transition:
			translate 160ms cubic-bezier(0.2, 0.9, 0.3, 1),
			background 160ms ease-out;
	}

	.row[aria-pressed='true'] .pip {
		background: var(--control-on);
	}

	.row[aria-pressed='true'] .pip::after {
		translate: 1.05rem 0;
		background: var(--control-on-ink);
	}
</style>
