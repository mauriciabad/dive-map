<script lang="ts">
	import { AVATARS } from './avatars.ts';
	import { avatarUrl } from './avatar-assets.ts';
	import type { PositionTracker } from './position.svelte.ts';
	import { type TrailWindow, WINDOW_CHOICES, sameWindow } from './trail.ts';
	import Panel from '$lib/ui/Panel.svelte';
	import Chip from '$lib/ui/controls/Chip.svelte';
	import ChipGroup from '$lib/ui/controls/ChipGroup.svelte';
	import Field from '$lib/ui/controls/Field.svelte';
	import Note from '$lib/ui/controls/Note.svelte';
	import Readout from '$lib/ui/controls/Readout.svelte';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import type { Reading } from '$lib/ui/controls/types';
	import { POSITION_PANEL_ID } from '$lib/ui/panel';
	import { LOOK_LABEL, lookOf } from '$lib/ui/position-status';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * Where the boat is and what it is doing, in the same vocabulary as every
	 * other panel. Eight live numbers sit in two rows of four instrument cells
	 * rather than a column of sentences, the eight trail windows are two rows of
	 * bare values instead of eight lines that each start with the same word, and
	 * the hints are on screen always rather than appearing with the thing they
	 * explain.
	 */

	interface Props {
		readonly tracker: PositionTracker;
		readonly locale: Locale;
		readonly onclose: () => void;
	}

	const { tracker, locale, onclose }: Props = $props();

	const MS_PER_KNOT = 1.94384;

	/** Written as escapes so no invisible character lands in the source. */
	const THIN = '\u2009';
	/** A cell with nothing in it yet. Eight of these is still eight cells. */
	const BLANK = '\u2013';

	/** Unit symbols, not words: `min`, `h`, `m` and `km` are the same in all three. */
	const windowLabel = (choice: TrailWindow): string =>
		choice.kind === 'duration'
			? choice.seconds >= 3600
				? `${choice.seconds / 3600}${THIN}h`
				: `${choice.seconds / 60}${THIN}min`
			: choice.metres >= 1000
				? `${choice.metres / 1000}${THIN}km`
				: `${choice.metres}${THIN}m`;

	const windowKey = (choice: TrailWindow): string =>
		choice.kind === 'duration' ? `t${choice.seconds}` : `d${choice.metres}`;

	const look = $derived(lookOf(tracker));

	const headline = $derived(t(locale, LOOK_LABEL[look]));

	const hint = $derived.by(() => {
		switch (tracker.watch.status) {
			case 'denied':
				return t(locale, 'geoDeniedHint');
			case 'unavailable':
				return t(locale, 'geoUnavailableHint');
			case 'timeout':
				return t(locale, 'geoTimeoutHint');
			case 'locating':
				return t(locale, 'noFixYet');
			case 'unsupported':
				return tracker.support === 'insecure' ? t(locale, 'geoInsecure') : '';
			case 'off':
			case 'tracking':
				return '';
		}
	});

	const distance = (metres: number): string =>
		metres >= 1000 ? `${(metres / 1000).toFixed(1)}${THIN}km` : `${Math.round(metres)}${THIN}m`;

	/**
	 * Eight facts a skipper reads at a glance, laid out as two rows of four
	 * instrument cells. Where you are, how good the fix is and how old it is on
	 * the top row; what the boat is doing and how much of it is drawn below.
	 * Every cell keeps its place when there is no fix, because a grid that
	 * reshuffles itself is unreadable on a moving deck. Each name is short enough
	 * to hold one line at a quarter of the panel's width.
	 */
	const readings = $derived.by<readonly Reading[]>(() => {
		const fix = tracker.fix;
		const course = tracker.course;
		const trail = tracker.trail;
		const first = trail.at(0);
		const last = trail.at(-1);
		const speedMs = course.kind === 'steaming' ? course.speedMs : fix?.speedMs;
		return [
			{ label: t(locale, 'latitude'), value: fix === undefined ? BLANK : fix.lat.toFixed(5) },
			{ label: t(locale, 'longitude'), value: fix === undefined ? BLANK : fix.lng.toFixed(5) },
			{
				label: t(locale, 'accuracy'),
				value: fix === undefined ? BLANK : `\u00b1${Math.round(fix.accuracyM)}${THIN}m`
			},
			{
				label: t(locale, 'fixAge'),
				value:
					fix === undefined
						? BLANK
						: `${Math.max(0, Math.round((tracker.now - fix.at) / 1000))}${THIN}s`
			},
			{
				label: t(locale, 'trajectory'),
				value: course.kind === 'steaming' ? `${Math.round(course.deg)}\u00b0` : BLANK
			},
			{
				label: t(locale, 'speed'),
				value: speedMs === undefined ? BLANK : `${(speedMs * MS_PER_KNOT).toFixed(1)}${THIN}kn`
			},
			{
				label: t(locale, 'trail'),
				value: first === undefined || last === undefined ? BLANK : distance(last.cumM - first.cumM)
			},
			{ label: t(locale, 'trailWindowShort'), value: windowLabel(tracker.window) }
		];
	});
</script>

<Panel id={POSITION_PANEL_ID} title={t(locale, 'myPosition')} {locale} anchor="top-right" {onclose}>
	<div class="state" data-look={look}>
		<span class="lamp" aria-hidden="true"></span>
		<p class="headline">{headline}</p>
	</div>
	{#if hint.length > 0}
		<Note>{hint}</Note>
	{/if}

	<div aria-live="polite">
		<Readout rows={readings} columns={4} />
	</div>

	<Toggle
		label={t(locale, 'showTrail')}
		pressed={tracker.showTrail}
		onchange={() => {
			tracker.showTrail = !tracker.showTrail;
		}}
	/>
	<Note>{t(locale, 'trailHint')}</Note>

	<Field label={t(locale, 'trailWindow')}>
		<ChipGroup columns={4}>
			{#each WINDOW_CHOICES as choice (windowKey(choice))}
				<Chip
					label={windowLabel(choice)}
					pressed={sameWindow(choice, tracker.window)}
					onclick={() => {
						tracker.setWindow(choice);
					}}
				/>
			{/each}
		</ChipGroup>
	</Field>

	<Toggle
		label={t(locale, 'showTrajectory')}
		pressed={tracker.showTrajectory}
		onchange={() => {
			tracker.showTrajectory = !tracker.showTrajectory;
		}}
	/>
	<Note>{t(locale, 'trajectoryHint')}</Note>

	<Field label={t(locale, 'avatarGroup')}>
		<div class="figures">
			{#each AVATARS as figure (figure.id)}
				<button
					type="button"
					title={t(locale, figure.key)}
					aria-pressed={tracker.avatar === figure.id}
					onclick={() => {
						tracker.avatar = figure.id;
					}}
				>
					<img src={avatarUrl(figure.id)} alt="" width="40" height="40" />
					<span class="visually-hidden">{t(locale, figure.key)}</span>
				</button>
			{/each}
		</div>
	</Field>
</Panel>

<style>
	.state {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	/* The same colour the corner button is wearing, so the two read as one thing. */
	.lamp {
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		background: var(--color-table-500);
	}

	.state[data-look='tracking'] .lamp {
		background: var(--color-sea-shallow);
	}

	.state[data-look='locating'] .lamp {
		background: var(--color-brass-400);
	}

	.state[data-look='stale'] .lamp {
		background: var(--color-buoy);
	}

	.state[data-look='denied'] .lamp,
	.state[data-look='unsupported'] .lamp {
		background: var(--color-hazard);
	}

	.headline {
		margin: 0;
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
		color: var(--control-ink);
	}

	.figures {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.35rem;
	}

	.figures button {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		min-height: var(--spacing-touch);
		padding: 0;
		border: 1px solid var(--ctrl-edge);
		border-radius: var(--control-radius);
		/* The dark face is the sea the figures were drawn to sit on. */
		background: var(--color-sea-deep);
		cursor: pointer;
		transition: border-color var(--control-ease);
	}

	.figures button:hover {
		border-color: var(--control-on-rim);
	}

	.figures button[aria-pressed='true'] {
		border-color: var(--control-on-rim);
		background: var(--control-on);
		box-shadow: var(--sunk);
	}

	img {
		width: 40px;
		height: 40px;
	}
</style>
