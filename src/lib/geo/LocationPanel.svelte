<script lang="ts">
	import { AVATARS } from './avatars.ts';
	import { avatarUrl } from './avatar-assets.ts';
	import { gt } from './messages.ts';
	import { type TrailWindow, WINDOW_CHOICES, sameWindow } from './trail.ts';
	import type { PositionTracker } from './position.svelte.ts';
	import type { Locale } from '$lib/i18n/locale';

	interface Props {
		readonly tracker: PositionTracker;
		readonly locale: Locale;
	}

	const { tracker, locale }: Props = $props();

	const MS_PER_KNOT = 1.94384;

	const windowLabel = (choice: TrailWindow): string =>
		choice.kind === 'duration'
			? choice.seconds >= 3600
				? gt(locale, 'windowHours', { n: choice.seconds / 3600 })
				: gt(locale, 'windowMinutes', { n: choice.seconds / 60 })
			: choice.metres >= 1000
				? gt(locale, 'windowKm', { n: choice.metres / 1000 })
				: gt(locale, 'windowMetres', { n: choice.metres });

	const status = $derived.by(() => {
		const { watch } = tracker;
		switch (watch.status) {
			case 'denied':
				return { title: gt(locale, 'geoDenied'), hint: gt(locale, 'geoDeniedHint') };
			case 'unavailable':
				return { title: gt(locale, 'geoUnavailable'), hint: gt(locale, 'geoUnavailableHint') };
			case 'timeout':
				return { title: gt(locale, 'geoTimeout'), hint: gt(locale, 'geoTimeoutHint') };
			case 'locating':
				return { title: gt(locale, 'locating'), hint: gt(locale, 'noFixYet') };
			case 'unsupported':
				return {
					title: gt(locale, 'geoUnsupported'),
					hint: tracker.support === 'insecure' ? gt(locale, 'geoInsecure') : ''
				};
			case 'off':
				return { title: gt(locale, 'positionOff'), hint: '' };
			case 'tracking':
				return {
					title: gt(locale, 'accuracyM', { n: Math.round(watch.fix.accuracyM) }),
					hint: ''
				};
		}
	});

	const course = $derived.by(() => {
		const value = tracker.course;
		return value.kind === 'steaming'
			? gt(locale, 'courseReading', {
					deg: Math.round(value.deg),
					kn: (value.speedMs * MS_PER_KNOT).toFixed(1)
				})
			: gt(locale, 'courseStationary');
	});
</script>

<h2>{gt(locale, 'myPosition')}</h2>

<p class="status">{status.title}</p>
{#if status.hint.length > 0}
	<p class="hint">{status.hint}</p>
{/if}
<p class="course" aria-live="polite">{course}</p>

<label class="row">
	<input type="checkbox" bind:checked={tracker.showTrail} />
	<span>{gt(locale, 'showTrail')}</span>
</label>

{#if tracker.showTrail}
	<p class="hint">{gt(locale, 'trailHint')}</p>
	<fieldset>
		<legend>{gt(locale, 'trailWindow')}</legend>
		<div class="choices">
			{#each WINDOW_CHOICES as choice (choice.kind === 'duration' ? `t${choice.seconds}` : `d${choice.metres}`)}
				<button
					type="button"
					aria-pressed={sameWindow(choice, tracker.window)}
					onclick={() => {
						tracker.setWindow(choice);
					}}
				>
					{windowLabel(choice)}
				</button>
			{/each}
		</div>
	</fieldset>
{/if}

<label class="row">
	<input type="checkbox" bind:checked={tracker.showTrajectory} />
	<span>{gt(locale, 'showTrajectory')}</span>
</label>
{#if tracker.showTrajectory}
	<p class="hint">{gt(locale, 'trajectoryHint')}</p>
{/if}

<fieldset>
	<legend>{gt(locale, 'avatarGroup')}</legend>
	<div class="figures">
		{#each AVATARS as figure (figure.id)}
			<button
				type="button"
				title={gt(locale, figure.key)}
				aria-pressed={tracker.avatar === figure.id}
				onclick={() => {
					tracker.avatar = figure.id;
				}}
			>
				<img src={avatarUrl(figure.id)} alt="" width="40" height="40" />
				<span class="visually-hidden">{gt(locale, figure.key)}</span>
			</button>
		{/each}
	</div>
</fieldset>

<style>
	h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-brass-300);
	}

	p {
		margin: 0;
		font-size: 0.8rem;
	}

	.status {
		color: var(--color-paper);
		font-variant-numeric: tabular-nums;
	}

	.course {
		color: var(--color-sea-shallow);
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	.hint {
		color: var(--color-paper-dim);
		font-size: 0.72rem;
		line-height: 1.35;
	}

	.row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		min-height: var(--spacing-touch);
		font-size: 0.85rem;
		cursor: pointer;
	}

	input[type='checkbox'] {
		width: 1.15rem;
		height: 1.15rem;
		accent-color: var(--color-brass-500);
		flex: none;
	}

	fieldset {
		border: 0;
		border-top: 1px solid var(--ctrl-seam);
		margin: 0;
		padding: 0.55rem 0 0;
	}

	legend {
		padding: 0;
		font-size: 0.72rem;
		color: var(--color-paper-dim);
	}

	.choices {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.3rem;
		margin-top: 0.4rem;
	}

	.choices button {
		min-height: 2.1rem;
		padding: 0 0.4rem;
		border: 1px solid var(--ctrl-edge);
		border-radius: 4px;
		background: var(--color-table-700);
		color: var(--color-paper);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.figures {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.3rem;
		margin-top: 0.4rem;
	}

	.figures button {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		padding: 0;
		border: 1px solid var(--ctrl-edge);
		border-radius: 4px;
		/* The dark face is the sea the figures were drawn to sit on. */
		background: var(--color-sea-deep);
		cursor: pointer;
	}

	.choices button[aria-pressed='true'],
	.figures button[aria-pressed='true'] {
		border-color: var(--color-brass-400);
		background: var(--color-brass-500);
		color: var(--color-table-900);
		box-shadow: var(--sunk);
	}

	img {
		width: 40px;
		height: 40px;
	}
</style>
