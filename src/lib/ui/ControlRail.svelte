<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import type { MapState } from '$lib/state/map-view.svelte';
	import { LOCALES, LOCALE_NAMES } from '$lib/i18n/locale';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import type { LayerId } from '$lib/domain/card';

	const { view }: { view: MapState } = $props();

	type Section = 'layers' | 'isobaths' | 'print' | 'language';
	let open = $state<Section | undefined>(undefined);

	const tabs: readonly { readonly id: Section; readonly icon: IconName }[] = [
		{ id: 'layers', icon: 'layers' },
		{ id: 'isobaths', icon: 'isobath' },
		{ id: 'print', icon: 'print' },
		{ id: 'language', icon: 'language' }
	];

	interface LayerRow {
		readonly id: LayerId;
		readonly icon: IconName;
		readonly key: MessageKey;
	}

	const layerRows: readonly LayerRow[] = [
		{ id: 'hillshade', icon: 'relief', key: 'relief' },
		{ id: 'depth-tint', icon: 'depth', key: 'depthTint' },
		{ id: 'coastline', icon: 'frame', key: 'coastline' },
		{ id: 'osm', icon: 'buoy', key: 'osmFeatures' },
		{ id: 'annotations', icon: 'annotate', key: 'annotations' }
	];

	const INTERVALS = [1, 2, 5, 10, 20] as const;
	const EMPHASIS_CHOICES = [5, 10, 18, 20, 30, 40, 50, 60] as const;
	const MAX_DEPTHS = [30, 40, 50, 60, 80] as const;

	const toggleSection = (id: Section) => {
		open = open === id ? undefined : id;
	};
</script>

<svelte:window
	onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape' && open !== undefined) open = undefined;
	}}
/>

{#if open !== undefined}
	<section class="drawer" aria-label={t(view.locale, open === 'print' ? 'print' : open)}>
		<header>
			<h2>{t(view.locale, open === 'print' ? 'print' : open)}</h2>
			<button type="button" class="icon-btn" onclick={() => (open = undefined)}>
				<Icon name="close" size={20} />
				<span class="sr">{t(view.locale, 'close')}</span>
			</button>
		</header>

		<div class="body">
			{#if open === 'layers'}
				<fieldset>
					<legend>{t(view.locale, 'ground')}</legend>
					<div class="segmented">
						{#each (['habitats', 'substrate'] as const) as ground (ground)}
							<button
								type="button"
								class="seg"
								aria-pressed={view.groundLayer === ground}
								onclick={() => {
									view.groundLayer = ground;
									if (!view.shows(ground)) view.toggle(ground);
								}}
							>
								<Icon name={ground === 'habitats' ? 'habitat' : 'substrate'} size={18} />
								{t(view.locale, ground)}
							</button>
						{/each}
					</div>
					<p class="note">{t(view.locale, 'accuracyNote')}</p>
				</fieldset>

				<ul class="rows">
					{#each layerRows as row (row.id)}
						<li>
							<button type="button" class="row" aria-pressed={view.shows(row.id)} onclick={() => { view.toggle(row.id); }}>
								<Icon name={row.icon} size={20} />
								<span>{t(view.locale, row.key)}</span>
								<span class="pip" aria-hidden="true"></span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if open === 'isobaths'}
				<fieldset>
					<legend>{t(view.locale, 'interval')}</legend>
					<div class="segmented">
						{#each INTERVALS as metres (metres)}
							<button
								type="button"
								class="seg num"
								aria-pressed={view.isobaths.intervalM === metres}
								onclick={() => { view.setInterval(metres); }}
							>{metres}&thinsp;m</button>
						{/each}
					</div>
				</fieldset>

				<fieldset>
					<legend>{t(view.locale, 'emphasised')}</legend>
					<div class="chips">
						{#each EMPHASIS_CHOICES as depth (depth)}
							<button
								type="button"
								class="chip"
								aria-pressed={view.isobaths.emphasised.includes(depth)}
								onclick={() => { view.toggleEmphasis(depth); }}
							>{depth}&thinsp;m</button>
						{/each}
					</div>
				</fieldset>

				<fieldset>
					<legend>{t(view.locale, 'maxDepth')}</legend>
					<div class="segmented">
						{#each MAX_DEPTHS as metres (metres)}
							<button
								type="button"
								class="seg num"
								aria-pressed={view.isobaths.maxDepthM === metres}
								onclick={() => { view.setMaxDepth(metres); }}
							>{metres}&thinsp;m</button>
						{/each}
					</div>
				</fieldset>

				<button type="button" class="row" aria-pressed={view.isobaths.labels} onclick={() => { view.toggleLabels(); }}>
					<Icon name="depth" size={20} />
					<span>{t(view.locale, 'showLabels')}</span>
					<span class="pip" aria-hidden="true"></span>
				</button>
			{:else if open === 'print'}
				<button
					type="button"
					class="row primary"
					aria-pressed={view.framing}
					onclick={() => (view.framing = !view.framing)}
				>
					<Icon name="frame" size={20} />
					<span>{t(view.locale, 'framing')}</span>
					<span class="pip" aria-hidden="true"></span>
				</button>
				<p class="note">{t(view.locale, 'framingHint')}</p>
			{:else}
				<ul class="rows">
					{#each LOCALES as locale (locale)}
						<li>
							<button type="button" class="row" aria-pressed={view.locale === locale} onclick={() => (view.locale = locale)}>
								<span>{LOCALE_NAMES[locale]}</span>
								<span class="pip" aria-hidden="true"></span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<p class="disclaimer">{t(view.locale, 'disclaimer')}</p>
	</section>
{/if}

<nav class="rail" aria-label={t(view.locale, 'layers')}>
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			class="tab"
			aria-expanded={open === tab.id}
			aria-pressed={open === tab.id}
			onclick={() => { toggleSection(tab.id); }}
		>
			<Icon name={tab.icon} />
			<span class="sr">{t(view.locale, tab.id === 'print' ? 'print' : tab.id)}</span>
		</button>
	{/each}
</nav>

<style>
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* One brass rail: bottom on a phone held in one hand, left on a desktop. */
	.rail {
		position: fixed;
		z-index: 20;
		display: flex;
		gap: 0.25rem;
		padding: 0.3rem;
		background: linear-gradient(180deg, var(--color-table-700), var(--color-table-800));
		border: 1px solid rgb(184 137 63 / 0.35);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		inset: auto 0 max(0.75rem, env(safe-area-inset-bottom)) 0;
		margin-inline: auto;
		width: max-content;
	}

	@media (min-width: 48rem) {
		.rail {
			inset: 50% auto auto 0.85rem;
			translate: 0 -50%;
			flex-direction: column;
			margin-inline: 0;
		}
	}

	.tab {
		display: grid;
		place-items: center;
		width: var(--spacing-touch);
		height: var(--spacing-touch);
		border: 0;
		border-radius: calc(var(--radius-rail) - 0.2rem);
		background: transparent;
		color: var(--color-brass-300);
		cursor: pointer;
		transition: background 160ms ease-out, color 160ms ease-out;
	}

	.tab:hover {
		background: rgb(184 137 63 / 0.14);
		color: var(--color-paper);
	}

	.tab[aria-pressed='true'] {
		background: var(--color-brass-500);
		color: var(--color-table-900);
		box-shadow: var(--sunk);
	}

	.drawer {
		position: fixed;
		z-index: 19;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--color-table-800);
		border: 1px solid rgb(184 137 63 / 0.3);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		inset: auto 0.75rem calc(var(--spacing-touch) + 1.6rem) 0.75rem;
		max-height: 62svh;
		padding: 0.9rem 1rem 0.75rem;
	}

	@media (min-width: 48rem) {
		.drawer {
			inset: 50% auto auto calc(0.85rem + var(--spacing-touch) + 1rem);
			translate: 0 -50%;
			width: 21rem;
			max-height: 78svh;
		}
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-brass-300);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		overflow-y: auto;
		padding-block: 0.25rem;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	legend {
		padding: 0;
		font-size: 0.72rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-paper-dim);
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: var(--spacing-touch);
		padding: 0 0.6rem;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-paper);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 150ms ease-out;
	}

	.row:hover {
		background: rgb(239 228 207 / 0.07);
	}

	.row span:first-of-type {
		flex: 1;
	}

	.pip {
		width: 2.3rem;
		height: 1.25rem;
		border-radius: 999px;
		background: var(--color-table-600);
		box-shadow: var(--sunk);
		position: relative;
		transition: background 160ms ease-out;
	}

	.pip::after {
		content: '';
		position: absolute;
		inset: 2px auto 2px 2px;
		width: 1.05rem;
		border-radius: 999px;
		background: var(--color-paper-dim);
		transition: translate 160ms cubic-bezier(0.2, 0.9, 0.3, 1), background 160ms ease-out;
	}

	.row[aria-pressed='true'] .pip {
		background: var(--color-brass-500);
	}

	.row[aria-pressed='true'] .pip::after {
		translate: 1.05rem 0;
		background: var(--color-table-900);
	}

	.segmented {
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--color-table-900);
		border-radius: 0.4rem;
		box-shadow: var(--sunk);
	}

	.seg {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: calc(var(--spacing-touch) - 0.5rem);
		padding: 0 0.5rem;
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--color-paper-dim);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 150ms ease-out, color 150ms ease-out;
	}

	.seg.num {
		font-variant-numeric: tabular-nums;
	}

	.seg:hover {
		color: var(--color-paper);
	}

	.seg[aria-pressed='true'] {
		background: var(--color-brass-500);
		color: var(--color-table-900);
		font-weight: 600;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.chip {
		min-height: calc(var(--spacing-touch) - 0.65rem);
		padding: 0 0.7rem;
		border: 1px solid var(--color-table-500);
		border-radius: 999px;
		background: transparent;
		color: var(--color-paper-dim);
		font: inherit;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: border-color 150ms ease-out, color 150ms ease-out, background 150ms ease-out;
	}

	.chip:hover {
		border-color: var(--color-brass-500);
		color: var(--color-paper);
	}

	.chip[aria-pressed='true'] {
		background: var(--color-brass-500);
		border-color: var(--color-brass-400);
		color: var(--color-table-900);
		font-weight: 700;
	}

	.icon-btn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 0.3rem;
		background: transparent;
		color: var(--color-paper-dim);
		cursor: pointer;
	}

	.icon-btn:hover {
		color: var(--color-paper);
		background: rgb(239 228 207 / 0.08);
	}

	.note {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-paper-dim);
	}

	.disclaimer {
		margin: 0;
		padding-top: 0.5rem;
		border-top: 1px solid rgb(184 137 63 / 0.18);
		font-size: 0.7rem;
		color: var(--color-paper-dim);
	}
</style>
