<script lang="ts">
	import Panel from './Panel.svelte';
	import Segmented from './controls/Segmented.svelte';
	import type { Choice } from './controls/types';
	import { PANEL_ID } from './panel';
	import { FLAGS } from '$lib/i18n/flags';
	import { LOCALES, LOCALE_NAMES, type Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	const choices: readonly Choice<Locale>[] = LOCALES.map((value) => ({
		value,
		label: LOCALE_NAMES[value],
		image: FLAGS[value]
	}));
</script>

<Panel
	id={PANEL_ID}
	title={t(view.locale, 'language')}
	locale={view.locale}
	anchor="top-left"
	{onclose}
>
	<Segmented
		options={choices}
		value={view.locale}
		label={t(view.locale, 'language')}
		onselect={(next: Locale) => {
			view.locale = next;
		}}
	/>
</Panel>
