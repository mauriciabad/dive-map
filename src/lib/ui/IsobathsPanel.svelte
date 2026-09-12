<script lang="ts">
	import Panel from './Panel.svelte';
	import Chip from './controls/Chip.svelte';
	import ChipGroup from './controls/ChipGroup.svelte';
	import Field from './controls/Field.svelte';
	import Note from './controls/Note.svelte';
	import Segmented from './controls/Segmented.svelte';
	import Toggle from './controls/Toggle.svelte';
	import type { Choice } from './controls/types';
	import { PANEL_ID } from './panel';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	/** `auto` is a real choice alongside the fixed intervals, not a switch beside them. */
	type Interval = number | 'auto';

	const INTERVALS = [1, 2, 5, 10, 20] as const;
	const EMPHASIS_CHOICES = [5, 10, 18, 20, 30, 40, 50, 60] as const;
	const MAX_DEPTHS = [30, 40, 50, 60, 80] as const;

	/** Written as an escape so no invisible character lands in the source. */
	const THIN = '\u2009';

	const metres = (value: number): string => `${value}${THIN}m`;

	const intervals = $derived<readonly Choice<Interval>[]>([
		{ value: 'auto', label: t(view.locale, 'autoInterval') },
		...INTERVALS.map((value) => ({ value, label: metres(value) }))
	]);

	const depths = $derived<readonly Choice<number>[]>(
		MAX_DEPTHS.map((value) => ({ value, label: metres(value) }))
	);

	const interval = $derived<Interval>(
		view.isobaths.autoInterval ? 'auto' : view.isobaths.intervalM
	);
</script>

<Panel
	id={PANEL_ID}
	title={t(view.locale, 'isobaths')}
	locale={view.locale}
	anchor="top-left"
	{onclose}
>
	<Field label={t(view.locale, 'interval')}>
		<Segmented
			options={intervals}
			value={interval}
			numeric
			onselect={(next: Interval) => {
				if (next === 'auto') view.setAutoInterval();
				else view.setInterval(next);
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
	</Field>

	<Field label={t(view.locale, 'maxDepth')}>
		<Segmented
			options={depths}
			value={view.isobaths.maxDepthM}
			numeric
			onselect={(next: number) => {
				view.setMaxDepth(next);
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
