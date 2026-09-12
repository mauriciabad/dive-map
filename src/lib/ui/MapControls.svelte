<script lang="ts">
	import Icon from './Icon.svelte';
	import { PANEL_ID, SECTIONS, type PanelProps } from './panel';
	import { t } from '$lib/i18n/messages';

	const { view, panel }: PanelProps = $props();
</script>

{#each SECTIONS as tab (tab.id)}
	<button
		type="button"
		title={t(view.locale, tab.key)}
		aria-expanded={panel.open === tab.id}
		aria-controls={PANEL_ID}
		onclick={() => {
			panel.open = panel.open === tab.id ? undefined : tab.id;
		}}
	>
		<Icon name={tab.icon} size={22} />
		<span class="visually-hidden">{t(view.locale, tab.key)}</span>
	</button>
{/each}
