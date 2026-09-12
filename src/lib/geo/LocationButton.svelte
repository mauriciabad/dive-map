<script lang="ts">
	import type { PositionTracker } from './position.svelte.ts';
	import { LOOK_LABEL, lookOf } from '$lib/ui/position-status';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	interface Props {
		readonly tracker: PositionTracker;
		readonly locale: Locale;
		readonly panelId: string;
	}

	const { tracker, locale, panelId }: Props = $props();

	const look = $derived(lookOf(tracker));
	const label = $derived(t(locale, LOOK_LABEL[look]));
	const on = $derived(look === 'tracking' || look === 'stale');
</script>

<button
	type="button"
	title={label}
	aria-pressed={on}
	data-look={look}
	disabled={look === 'unsupported'}
	onclick={() => {
		tracker.toggle();
	}}
>
	<svg
		viewBox="0 0 24 24"
		width="22"
		height="22"
		fill="none"
		stroke="currentColor"
		stroke-width="2.2"
		stroke-linecap="round"
		aria-hidden="true"
	>
		<path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" />
		<circle class="ring" cx="12" cy="12" r="6.4" />
		{#if on}
			<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
		{/if}
		{#if look === 'denied' || look === 'unsupported'}
			<path d="M6.8 6.8 17.2 17.2" />
		{/if}
	</svg>
	<span class="visually-hidden">{label}</span>
</button>

{#if tracker.enabled}
	<button
		type="button"
		title={t(locale, 'trail')}
		aria-expanded={tracker.panelOpen}
		aria-controls={panelId}
		onclick={() => {
			tracker.panelOpen = !tracker.panelOpen;
		}}
	>
		<svg
			viewBox="0 0 24 24"
			width="22"
			height="22"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M3.2 18.5c3.4-.4 5-2.2 6.2-5.2 1.3-3.3 3-5.5 6.4-6.1" />
			<circle cx="18.4" cy="6.2" r="2.6" fill="currentColor" stroke="none" />
			<circle cx="4" cy="19.4" r="1.4" fill="currentColor" stroke="none" opacity="0.45" />
		</svg>
		<span class="visually-hidden">{t(locale, 'trail')}</span>
	</button>
{/if}

<style>
	/* Amber, not red: the position is old, which on a boat under a bimini is
	   normal and recovers on its own. */
	button[data-look='stale'] {
		color: var(--color-buoy);
	}

	button[data-look='denied'] {
		color: var(--color-hazard);
	}

	button[data-look='locating'] .ring {
		stroke-dasharray: 11 29;
		transform-origin: 12px 12px;
		animation: sweep 1.4s linear infinite;
	}

	@keyframes sweep {
		to {
			transform: rotate(360deg);
		}
	}
</style>
