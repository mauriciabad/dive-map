<script lang="ts">
	import Panel from './Panel.svelte';
	import Chip from './controls/Chip.svelte';
	import ChipGroup from './controls/ChipGroup.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import Range from './controls/Range.svelte';
	import Toggle from './controls/Toggle.svelte';
	import { PANEL_ID } from './panel';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	const EMPHASIS_CHOICES = [0, 5, 10, 18, 20, 30, 40, 50, 60] as const;

	/**
	 * Below every real interval, so the shallow end of the track is where the map
	 * picks for itself. It is a position on the same slider rather than a switch
	 * beside it, because "let the zoom decide" is the coarsest setting there is.
	 */
	const AUTO = 0;

	/** The coarsest interval offered, and what auto falls back to when zoomed out. */
	const COARSEST_M = 20;

	/** Deep enough for the whole survey, which bottoms out at 80.7 m. */
	const DEEPEST_M = 100;

	/** Written as an escape so no invisible character lands in the source. */
	const THIN = '\u2009';

	const metres = (value: number): string => `${value}${THIN}m`;

	const interval = $derived(view.isobaths.autoInterval ? AUTO : view.isobaths.intervalM);

	/** A hand-edited blob can carry a setting past the end of the track. Show it rather than clamp it. */
	const coarsest = $derived(Math.max(COARSEST_M, view.isobaths.intervalM));
	const deepest = $derived(Math.max(DEEPEST_M, view.isobaths.maxDepthM));
</script>

<Panel
	id={PANEL_ID}
	title={t(view.locale, 'isobaths')}
	locale={view.locale}
	anchor="top-left"
	{onclose}
>
	<Field label={t(view.locale, 'interval')}>
		<Range
			label={t(view.locale, 'interval')}
			value={interval}
			min={AUTO}
			max={coarsest}
			format={(value: number) => (value === AUTO ? t(view.locale, 'autoInterval') : metres(value))}
			onchange={(next: number) => {
				view.isobaths =
					next === AUTO
						? { ...view.isobaths, autoInterval: true }
						: { ...view.isobaths, intervalM: next, autoInterval: false };
			}}
		/>
		<Note>{t(view.locale, 'autoIntervalHint')}</Note>
	</Field>

	<Field label={t(view.locale, 'emphasised')}>
		<ChipGroup columns={4}>
			{#each EMPHASIS_CHOICES as depth (depth)}
				<Chip
					label={metres(depth)}
					pressed={view.isobaths.emphasised.includes(depth)}
					onclick={() => {
						view.toggleEmphasis(depth);
					}}
				/>
			{/each}
		</ChipGroup>
		<Note>{t(view.locale, 'zeroIsobathHint')}</Note>
	</Field>

	<Field label={t(view.locale, 'maxDepth')}>
		<Range
			label={t(view.locale, 'maxDepth')}
			value={view.isobaths.maxDepthM}
			min={5}
			max={deepest}
			format={metres}
			onchange={(next: number) => {
				view.isobaths = { ...view.isobaths, maxDepthM: next };
			}}
		/>
	</Field>

	<Toggle
		label={t(view.locale, 'showLabels')}
		icon="depth"
		pressed={view.isobaths.labels}
		onchange={() => {
			view.toggleLabels();
		}}
	/>
</Panel>
