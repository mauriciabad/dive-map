<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import { NO_BASE_MAP, type BaseMapId, baseMapOf, quickNext } from '$lib/domain/basemaps';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	/**
	 * One press to swap the base map, for the hand that is holding something else.
	 *
	 * The base map picker is a panel, and a panel is four presses away from a
	 * diver who only ever wants the photograph on and then off again. This is
	 * that one press, and the two maps it flicks between are the diver's own
	 * choice rather than a pair hard-coded here.
	 *
	 * It shows where it is going, not where it is. A button that showed the
	 * current map would be a readout, and there is already a map on screen
	 * saying that.
	 */

	interface Props {
		readonly view: MapState;
	}

	const { view }: Props = $props();

	const KIND_KEY: Record<'satellite' | 'standard' | 'classic', MessageKey> = {
		satellite: 'baseMapSatellite',
		standard: 'baseMapStandard',
		classic: 'baseMapClassic'
	};

	/**
	 * The archive's own name after the shelf it sits on, which is how the picker
	 * names them too. The names are proper nouns and are never translated; only
	 * the shelf is.
	 */
	const nameOf = (id: BaseMapId): string => {
		if (id === NO_BASE_MAP) return t(view.locale, 'baseMapNone');
		const map = baseMapOf(id);
		if (map === undefined) return t(view.locale, 'baseMapNone');
		return `${t(view.locale, KIND_KEY[map.kind])} ${map.name}`;
	};

	/**
	 * The chart's own mark for going back to the chart, the photograph's for a
	 * photograph, and the stack for a borrowed map of any other kind.
	 */
	const iconOf = (id: BaseMapId): IconName => {
		if (id === NO_BASE_MAP) return 'isobath';
		return baseMapOf(id)?.kind === 'satellite' ? 'satellite' : 'layers';
	};

	const next = $derived(quickNext(view.quickToggle, view.baseMap));
	const label = $derived(nameOf(next));
</script>

<button
	type="button"
	title={label}
	onclick={() => {
		view.flipBaseMap();
	}}
>
	<Icon name={iconOf(next)} size={22} />
	<span class="visually-hidden">{label}</span>
</button>
