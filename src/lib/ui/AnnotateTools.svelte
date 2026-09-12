<script lang="ts">
	import AnnotatePanel from '$lib/annotate/AnnotatePanel.svelte';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { Locale } from '$lib/i18n/locale';

	/**
	 * Bottom-left is the only corner MapLibre is not already using, and on a phone
	 * held in one hand it is the corner a thumb reaches without regripping. The
	 * panel opens upward from there, which is why it renders above the bar.
	 */
	const { locale }: { readonly locale: Locale } = $props();

	// `SvelteControl` reads the props object once, so the panel reads through a
	// getter and keeps seeing the current locale without a second mount.
	const live = {
		get locale(): Locale {
			return locale;
		}
	};

	$effect(() =>
		whenMapReady((map) => {
			const control = new SvelteControl(AnnotatePanel, {
				props: { map, live },
				className: 'maplibregl-ctrl'
			});
			map.addControl(control, 'bottom-left');
			return () => {
				map.removeControl(control);
			};
		})
	);
</script>
