<script lang="ts">
	import Chip from './controls/Chip.svelte';
	import ChipGroup from './controls/ChipGroup.svelte';
	import {
		BASE_MAPS,
		BASE_MAP_KINDS,
		type BaseMapId,
		type BaseMapKind,
		NO_BASE_MAP
	} from '$lib/domain/basemaps';
	import type { Locale } from '$lib/i18n/locale';
	import { type MessageKey, t } from '$lib/i18n/messages';

	/**
	 * The ten base maps, grouped by the shelf each sits on.
	 *
	 * Two controls in the panel ask the same question of the same ten options, so
	 * there is one control and it is asked twice: which map is under the chart,
	 * and which two the corner toggle flicks between. `chosen` is a list rather
	 * than a single id for exactly that reason, and it is the only difference
	 * between the two uses.
	 *
	 * The archives' names are proper nouns and are never translated. Only the
	 * shelf above them is, which is also how the corner button names where it is
	 * about to take you.
	 */

	interface Props {
		readonly locale: Locale;
		/** Every option to draw as taken. One for the picker, two for the pair. */
		readonly chosen: readonly BaseMapId[];
		readonly onpick: (id: BaseMapId) => void;
	}

	const { locale, chosen, onpick }: Props = $props();

	const KIND_KEY: Record<BaseMapKind, MessageKey> = {
		satellite: 'baseMapSatellite',
		standard: 'baseMapStandard',
		classic: 'baseMapClassic'
	};

	/** The best of its shelf, marked the way issue #40 marks it. */
	const label = (name: string, recommended: boolean): string => (recommended ? `${name} ★` : name);
</script>

<div class="picker">
	<ChipGroup>
		<Chip
			label={t(locale, 'baseMapNone')}
			pressed={chosen.includes(NO_BASE_MAP)}
			onclick={() => {
				onpick(NO_BASE_MAP);
			}}
		/>
	</ChipGroup>
	{#each BASE_MAP_KINDS as kind (kind)}
		<div class="shelf">
			<span class="kind">{t(locale, KIND_KEY[kind])}</span>
			<ChipGroup>
				{#each BASE_MAPS.filter((map) => map.kind === kind) as map (map.id)}
					<Chip
						label={label(map.name, map.recommended)}
						pressed={chosen.includes(map.id)}
						onclick={() => {
							onpick(map.id);
						}}
					/>
				{/each}
			</ChipGroup>
		</div>
	{/each}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
	}

	.shelf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	/* Fixed so the three rows of chips start on one line rather than stepping in
	   and out with the length of the word above them. */
	.kind {
		flex: none;
		width: 4.4rem;
		font-size: var(--control-label);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}
</style>
