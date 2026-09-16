<script lang="ts">
	import BaseMapTile from './BaseMapTile.svelte';
	import { baseMapKindName } from './basemap-name';
	import {
		BASE_MAPS,
		BASE_MAP_KINDS,
		type BaseMapId,
		type BaseMapKind,
		NO_BASE_MAP
	} from '$lib/domain/basemaps';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * The ten base maps, as the maps themselves rather than as a list of names.
	 *
	 * Names alone could not do this job. ICGC and IGN each publish a photograph, a
	 * road map and a topographic sheet, so a row reading ICGC says nothing about
	 * what pressing it would put under the chart. Every tile is an extracted tile
	 * of the same stretch of the Begur coast, so the shelves are told apart by
	 * looking, and two archives' versions of the same shelf are compared by
	 * looking too.
	 *
	 * The chart itself shares the bottom line rather than taking one of its own.
	 * It sits beside the shortest shelf, so that line was half empty anyway, and a
	 * whole row spent on the absence of a base map was a row of scroll a diver
	 * paid for on a phone held over a boat's rail.
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

	interface Option {
		readonly id: BaseMapId;
		/** Absent where the heading above already says it, which is the chart. */
		readonly label?: string;
		readonly recommended: boolean;
	}

	interface Group {
		readonly key: string;
		readonly heading: string;
		readonly options: readonly Option[];
		/** Ruled off from the shelf it shares a line with. */
		readonly apart: boolean;
	}

	const shelf = (kind: BaseMapKind): Group => ({
		key: kind,
		heading: baseMapKindName(kind, locale),
		options: BASE_MAPS.filter((map) => map.kind === kind).map((map) => ({
			id: map.id,
			label: map.name,
			recommended: map.recommended
		})),
		apart: false
	});

	const chart = (): Group => ({
		key: NO_BASE_MAP,
		heading: t(locale, 'baseMapNone'),
		options: [{ id: NO_BASE_MAP, recommended: false }],
		apart: true
	});

	/**
	 * Every shelf on a line of its own except the last, which shares one with the
	 * chart. Sliced rather than named, so the catalogue goes on saying which
	 * shelves there are and in what order.
	 */
	const rows = $derived<readonly (readonly Group[])[]>([
		...BASE_MAP_KINDS.slice(0, -1).map((kind) => [shelf(kind)]),
		[...BASE_MAP_KINDS.slice(-1).map((kind) => shelf(kind)), chart()]
	]);
</script>

<div class="picker">
	{#each rows as row (row[0]?.key)}
		<div class="row">
			{#each row as group (group.key)}
				<section class={['shelf', { apart: group.apart }]}>
					<span class="kind">{group.heading}</span>
					<div class="tiles">
						{#each group.options as option (option.id)}
							<BaseMapTile
								id={option.id}
								label={option.label}
								{locale}
								pressed={chosen.includes(option.id)}
								recommended={option.recommended}
								onpick={() => {
									onpick(option.id);
								}}
							/>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/each}
</div>

<style>
	/*
	 * One width for every tile in the picker, set here rather than in the tile so
	 * a shelf of two draws the same square as a shelf of four. Four of them and
	 * their gaps come to 282px, which fits the panel on the narrowest phone this
	 * app supports.
	 */
	.picker {
		--tile: 4.15rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	/* The shortest shelf and the chart, side by side. They wrap onto separate
	   lines rather than squeezing if a phone is narrower than this app expects. */
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		align-items: flex-start;
	}

	.shelf {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	/* A rule, because the chart is not another kind of borrowed map and should not
	   read as one more entry on the shelf beside it. */
	.shelf.apart {
		padding-left: 0.7rem;
		border-left: 1px solid var(--control-rim);
	}

	.kind {
		font-size: var(--control-label);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}

	.tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
</style>
