<script lang="ts">
	import { GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
	import { asset } from '$app/paths';
	import Icon from '$lib/ui/Icon.svelte';
	import { type Annotation, KINDS, KIND_IDS, newAnnotation } from './annotation.ts';
	import { type DrawHandle, type DrawModeName, createDraw, roundPosition, toSourceData } from './draw.ts';
	import { type AnnotateKey, at } from './messages.ts';
	import { AnnotationStore, KIND_KEYS } from './store.svelte.ts';
	import { browserStore } from './storage.ts';
	import type { Locale } from '$lib/i18n/locale';

	interface Props {
		readonly map: MapLibreMap | undefined;
		/** A live view of the registrar's props, which `mount` would otherwise freeze. */
		readonly live: { readonly locale: Locale };
	}

	const { map, live }: Props = $props();
	const locale = $derived(live.locale);

	const MODE_IDS: readonly DrawModeName[] = ['select', 'point', 'linestring', 'polygon'];

	const MODE_KEYS: Readonly<Record<DrawModeName, AnnotateKey>> = {
		select: 'drawSelect',
		point: 'drawPoint',
		linestring: 'drawLine',
		polygon: 'drawArea'
	};

	const HINT_KEYS: Readonly<Record<DrawModeName, AnnotateKey>> = {
		select: 'drawSelectHint',
		point: 'drawPointHint',
		linestring: 'drawLineHint',
		polygon: 'drawAreaHint'
	};

	const store = new AnnotationStore(browserStore(), () => locale);

	let open = $state(false);
	let mode = $state<DrawModeName>('select');

	const drawingShape = $derived(mode === 'linestring' || mode === 'polygon');

	let handle: DrawHandle | undefined;
	let applied: string | undefined;
	let appliedTo: unknown;

	const colourOf = (id: string | undefined): string => {
		const annotation = id === undefined ? undefined : store.working.find((a) => a.id === id);
		return KINDS[annotation?.kind ?? store.kind].colour;
	};

	const fetchCommitted = async (): Promise<unknown> => {
		const response = await fetch(asset('/data/annotations.geojson'));
		// Nobody has committed one yet. That is a first run, not a failure to merge.
		if (response.status === 404) return { type: 'FeatureCollection', features: [] };
		if (!response.ok) throw new Error(`annotations.geojson: ${response.status}`);
		const body: unknown = await response.json();
		return body;
	};

	/**
	 * A style rebuild keeps the source id and throws away the object behind it, so
	 * identity is what says "this is a fresh, empty source" rather than the data.
	 * Comparing both means a styledata storm costs one comparison, not one retile.
	 */
	const applyToSource = (m: MapLibreMap, annotations: readonly Annotation[]): void => {
		const source = m.getSource('annotations');
		if (!(source instanceof GeoJSONSource)) return;
		const data = toSourceData(annotations);
		const key = JSON.stringify(data);
		if (key === applied && source === appliedTo) return;
		void source.setData(data);
		applied = key;
		appliedTo = source;
	};

	/**
	 * Always on. The annotations belong to the map whether or not anyone is drawing,
	 * and they reach it only through the style's own `annotations` source.
	 */
	const feed = (): (() => void) | undefined => {
		const m = map;
		if (m === undefined) return undefined;

		$effect(() => {
			applyToSource(m, store.working);
		});

		const reapply = (): void => {
			applyToSource(m, store.working);
		};
		m.on('styledata', reapply);

		return () => {
			m.off('styledata', reapply);
			applied = undefined;
			appliedTo = undefined;
		};
	};

	/**
	 * Only while the panel is open. Terra Draw paints its own handles over the map,
	 * which is what you want with a pen in your hand and clutter the rest of the
	 * time, so closing the panel takes its layers off the map entirely.
	 */
	const wire = (): (() => void) | undefined => {
		const m = map;
		if (m === undefined || !open) return undefined;

		const created = createDraw(m, {
			colourOf,
			ondraw: ({ id, geometry }) => {
				store.add({ id, kind: store.kind, label: undefined, geometry });
			},
			ongeometry: ({ id, geometry }) => {
				store.replaceGeometry(id, geometry);
			},
			onselect: (id) => {
				store.select(id);
			}
		});
		handle = created;

		$effect(() => {
			created.setMode(mode);
		});

		$effect(() => {
			created.syncFeatures(store.working);
		});

		return () => {
			created.destroy();
			handle = undefined;
		};
	};

	const start = (): void => {
		void store.load(fetchCommitted);
	};

	const cancelDrawing = (): void => {
		store.select(undefined);
		handle?.setMode(mode);
	};

	const deleteSelection = (): void => {
		const id = handle?.deleteSelected() ?? store.selectedId;
		if (id !== undefined) store.remove(id);
	};

	const dropPointAtCentre = (): void => {
		if (map === undefined) return;
		const centre = map.getCenter();
		store.add(
			newAnnotation(store.kind, {
				type: 'Point',
				coordinates: roundPosition(centre.lng, centre.lat)
			})
		);
	};

	const exportFile = (): void => {
		const url = URL.createObjectURL(store.exportBlob());
		const a = document.createElement('a');
		a.href = url;
		a.download = 'annotations.geojson';
		a.click();
		URL.revokeObjectURL(url);
	};

	const isTyping = (target: EventTarget | null): boolean =>
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLElement && target.isContentEditable);

	const onKeyDown = (event: KeyboardEvent): void => {
		const target = event.target;
		const typing = isTyping(target);

		if (event.key === 'Escape') {
			if (typing && target instanceof HTMLElement) target.blur();
			else cancelDrawing();
			return;
		}
		if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) {
			event.preventDefault();
			deleteSelection();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			store.undo();
		}
	};
</script>

<svelte:window onkeydown={onKeyDown} />

{#if open}
	<section class="panel" aria-label={at(locale, 'annotate')}>
		<div class="body">
			<fieldset>
				<legend>{at(locale, 'kindGroup')}</legend>
				<div class="grid" role="toolbar" aria-label={at(locale, 'kindGroup')}>
					{#each KIND_IDS as kind (kind)}
						<button
							type="button"
							class="cell"
							aria-pressed={store.kind === kind}
							onclick={() => (store.kind = kind)}
						>
							<span class="swatch" style:background-color={KINDS[kind].colour} aria-hidden="true"
							></span>
							<span>{at(locale, KIND_KEYS[kind])}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<fieldset>
				<legend>{at(locale, 'toolGroup')}</legend>
				<div class="grid" role="toolbar" aria-label={at(locale, 'toolGroup')}>
					{#each MODE_IDS as id (id)}
						<button
							type="button"
							class="cell"
							aria-pressed={mode === id}
							onclick={() => (mode = id)}
						>
							<span>{at(locale, MODE_KEYS[id])}</span>
						</button>
					{/each}
				</div>
				<p class="note">{at(locale, HINT_KEYS[mode])}</p>
			</fieldset>

			<button type="button" class="row" onclick={dropPointAtCentre}>
				<Icon name="buoy" size={20} />
				<span>{at(locale, 'pointAtCentre')}</span>
			</button>

			<div class="field">
				<label for="annotate-label">{at(locale, 'labelField')}</label>
				<input
					id="annotate-label"
					type="text"
					autocomplete="off"
					placeholder={at(locale, 'labelPlaceholder')}
					disabled={store.selected === undefined}
					value={store.selected?.label ?? ''}
					oninput={(event) => {
						const id = store.selectedId;
						// Raw while typing. Trimming here would eat the space between two words.
						if (id !== undefined) store.setLabel(id, event.currentTarget.value, 'raw');
					}}
					onchange={(event) => {
						const id = store.selectedId;
						if (id !== undefined) store.setLabel(id, event.currentTarget.value);
					}}
				/>
			</div>

			<p class="count">
				{store.count === 0
					? at(locale, 'noAnnotations')
					: at(locale, 'annotationCount', { n: store.count })}
			</p>

			<button type="button" class="row primary" onclick={exportFile}>
				<Icon name="print" size={20} />
				<span>{at(locale, 'exportGeojson')}</span>
			</button>
			<p class="note">{at(locale, 'exportHint')}</p>
			<p class="note">{at(locale, 'annotateHint')}</p>
		</div>
	</section>
{/if}
<div class="dock" {@attach feed} {@attach wire} {@attach start}>
	{#if store.conflicts.length > 0}
		<div class="banner" role="alert">
			<strong>{at(locale, 'conflictTitle')}</strong>
			<p>{at(locale, 'conflictBody', { n: store.conflicts.length })}</p>
			<div class="choices">
				<button type="button" class="pill" onclick={() => { store.resolveConflicts('mine'); }}>
					{at(locale, 'keepMine')}
				</button>
				<button type="button" class="pill" onclick={() => { store.resolveConflicts('theirs'); }}>
					{at(locale, 'useFile')}
				</button>
			</div>
		</div>
	{/if}

	{#if store.arrived > 0 || store.withdrawn > 0}
		<div class="notice" role="status">
			<span>
				{#if store.arrived > 0}{at(locale, 'arrivedFromRepo', { n: store.arrived })}{/if}
				{#if store.withdrawn > 0}{at(locale, 'withdrawnFromRepo', { n: store.withdrawn })}{/if}
			</span>
			<button type="button" class="icon-btn" onclick={() => { store.dismissNotice(); }}>
				<Icon name="close" size={18} />
				<span class="sr">{at(locale, 'dismiss')}</span>
			</button>
		</div>
	{/if}

	{#if !store.durable}
		<p class="warning" role="alert">{at(locale, 'storageUnavailable')}</p>
	{/if}

	<div class="bar">
		<button
			type="button"
			class="tab"
			aria-expanded={open}
			aria-pressed={open}
			onclick={() => (open = !open)}
		>
			<Icon name="annotate" />
			<span class="sr">{at(locale, 'annotate')}</span>
		</button>

		{#if drawingShape}
			<button type="button" class="pill" onclick={() => handle?.finishShape()}>
				{at(locale, 'finishShape')}
			</button>
		{/if}

		<button type="button" class="pill" disabled={!store.canUndo} onclick={() => { store.undo(); }}>
			{at(locale, 'undo')}
		</button>

		<button
			type="button"
			class="pill"
			disabled={store.selected === undefined}
			onclick={deleteSelection}
		>
			{at(locale, 'deleteSelected')}
		</button>
	</div>

	<div class="sr" aria-live="polite">{store.announcement}</div>
</div>


<style>
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* MapLibre owns the corner. Everything here lays out inside the container it gives us. */
	.dock {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}

	.panel {
		margin-bottom: 0.4rem;
		width: min(21rem, calc(100vw - 5.5rem));
		max-height: min(62svh, 32rem);
		overflow-y: auto;
		padding: 0.75rem 0.9rem 0.6rem;
		background: var(--color-table-800);
		border: 1px solid rgb(184 137 63 / 0.3);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.3rem;
		background: linear-gradient(180deg, var(--color-table-700), var(--color-table-800));
		border: 1px solid rgb(184 137 63 / 0.35);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
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

	.pill {
		min-height: var(--spacing-touch);
		min-width: var(--spacing-touch);
		padding: 0 0.75rem;
		border: 1px solid var(--color-table-500);
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-paper);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		transition: border-color 150ms ease-out, background 150ms ease-out;
	}

	.pill:hover:not(:disabled) {
		border-color: var(--color-brass-500);
		background: rgb(184 137 63 / 0.14);
	}

	.pill:disabled {
		color: var(--color-paper-dim);
		opacity: 0.45;
		cursor: not-allowed;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		max-height: inherit;
		overflow-y: auto;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	legend {
		padding: 0;
		font-size: 0.72rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-paper-dim);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.25rem;
	}

	.cell {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: var(--spacing-touch);
		min-width: var(--spacing-touch);
		padding: 0.25rem 0.55rem;
		border: 1px solid var(--color-table-500);
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-paper);
		font: inherit;
		font-size: 0.82rem;
		text-align: left;
		cursor: pointer;
		transition: border-color 150ms ease-out, background 150ms ease-out;
	}

	.cell:hover {
		border-color: var(--color-brass-500);
	}

	.cell[aria-pressed='true'] {
		background: var(--color-brass-500);
		border-color: var(--color-brass-400);
		color: var(--color-table-900);
		font-weight: 600;
	}

	.swatch {
		flex: none;
		width: 0.95rem;
		height: 0.95rem;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px rgb(20 16 12 / 0.6);
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
		font-size: 0.86rem;
		text-align: left;
		cursor: pointer;
		transition: background 150ms ease-out;
	}

	.row:hover {
		background: rgb(239 228 207 / 0.07);
	}

	.row.primary {
		background: var(--color-brass-500);
		color: var(--color-table-900);
		font-weight: 600;
	}

	.row.primary:hover {
		background: var(--color-brass-400);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.field label {
		font-size: 0.72rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-paper-dim);
	}

	.field input {
		min-height: var(--spacing-touch);
		padding: 0 0.6rem;
		border: 1px solid var(--color-table-500);
		border-radius: 0.35rem;
		background: var(--color-table-900);
		box-shadow: var(--sunk);
		color: var(--color-paper);
		font: inherit;
		font-size: 0.9rem;
	}

	.field input:disabled {
		color: var(--color-paper-dim);
		opacity: 0.5;
	}

	.banner,
	.notice,
	.warning {
		width: 100%;
		margin: 0;
		padding: 0.6rem 0.75rem;
		background: var(--color-table-800);
		border: 1px solid rgb(184 137 63 / 0.3);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
		font-size: 0.82rem;
	}

	.banner {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		border-color: var(--color-hazard);
	}

	.banner p {
		margin: 0;
		color: var(--color-paper-dim);
	}

	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-paper-dim);
	}

	.notice span {
		flex: 1;
	}

	.warning {
		border-color: var(--color-buoy);
		color: var(--color-paper);
	}

	.icon-btn {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--spacing-touch);
		height: var(--spacing-touch);
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
		font-size: 0.74rem;
		line-height: 1.45;
		color: var(--color-paper-dim);
	}

	.count {
		margin: 0;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-brass-300);
	}
</style>
