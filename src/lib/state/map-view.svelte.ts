import { SvelteSet } from 'svelte/reactivity';
import { type LiveView, PrintState } from '$lib/print/print-state.svelte';
// Types only: these erase at compile time, so the state layer keeps no runtime
// dependency on the interface layer.
import type { PanelSection } from '$lib/ui/panel';
import type { FeaturePick } from '$lib/ui/feature-card';
import {
	DEFAULT_ISOBATHS,
	DEFAULT_LAYERS,
	DEFAULT_LAND_PAINT,
	DEFAULT_SEABED_PAINT,
	type DiveCard,
	type IsobathStyle,
	type LayerId,
	type LngLat,
	type PaintLevel,
	newCard
} from '$lib/domain/card';
import {
	type BaseMapId,
	DEFAULT_BASE_MAP,
	DEFAULT_QUICK_PAIR,
	NO_BASE_MAP,
	type QuickPair,
	quickNext,
	withQuickChoice
} from '$lib/domain/basemaps';
import {
	NO_TEXTURE_CHOICES,
	type SeabedClass,
	type TextureChoices,
	seabedKey,
	withoutChoice
} from '$lib/domain/habitat';
import { haloOf, paintOf } from '$lib/domain/isobaths';
import { type Locale, negotiate } from '$lib/i18n/locale';
import { type Camera, type Configuration, shippedConfiguration } from './configuration.ts';

/**
 * Layers the photograph switches off while it is on, and whether it also holds
 * the switch down.
 *
 * Both draw a second opinion over a picture that already shows the thing they
 * draw, so both go off. Only the veil is locked. It is the water column painted
 * as alpha laid over a photograph of the water, which is wrong rather than
 * merely redundant, and the isobath above it already gives the exact metre. The
 * relief lights the rock under the surface, which is a fair thing to want back,
 * so that switch keeps working.
 *
 * Switched off here rather than hidden in the style, which is where it was and is
 * not the same thing. `depth-tint` drives two layers, the veil and the wash over
 * sea past the survey's edge, and the style only ever silenced the veil. A diver
 * who had dialled the land paint up therefore got the wash over their photograph
 * with no switch on screen to explain it. One flag off at the source takes down
 * everything that reads it.
 */
const SUSPENDED_BY_PHOTO: readonly { readonly id: LayerId; readonly locked: boolean }[] = [
	{ id: 'depth-tint', locked: true },
	{ id: 'hillshade', locked: false }
];

/**
 * Everything the side panel changes and the style reads. One object rather than
 * scattered stores, so the style rebuild has a single source to diff against.
 *
 * Layer visibility is a Set rather than a bag of booleans because the style
 * asks "is this one on", never "which of these seven flags disagree".
 */
export class MapState {
	readonly visible = new SvelteSet<LayerId>(DEFAULT_LAYERS);
	isobaths = $state<IsobathStyle>({ ...DEFAULT_ISOBATHS });
	groundLayer = $state<'habitats' | 'substrate'>('habitats');
	/** The survey is a 10m raster. Off shows it as measured, staircase and all. */
	smoothed = $state(true);
	/**
	 * What the diver chose to paint each seabed class with, over the catalogue.
	 *
	 * Replaced whole rather than mutated, so the style rebuild and the legend both
	 * see one change rather than a field appearing under them mid-render.
	 */
	textures = $state<TextureChoices>(NO_TEXTURE_CHOICES);

	/**
	 * Kept apart from whether the ortophoto is on, so dialling the photo down and
	 * switching it off does not throw the choice away.
	 */
	seabedPaint = $state<PaintLevel>(DEFAULT_SEABED_PAINT);
	landPaint = $state<PaintLevel>(DEFAULT_LAND_PAINT);

	/**
	 * Which borrowed map is under the chart. One choice, never a set, so nothing
	 * here can reorder a photograph stack; see `$lib/domain/basemaps`.
	 *
	 * Written only through `setBaseMap`, which also mirrors it onto the `satellite`
	 * layer flag. That mirror is temporary. The style still asks `visible` whether
	 * to draw a photograph, and it goes the moment the style reads this field
	 * instead, which is the same wave that takes `satellite` out of `LayerId`.
	 */
	baseMap = $state<BaseMapId>(DEFAULT_BASE_MAP);

	/**
	 * The two base maps the corner toggle flicks between, resting one first.
	 *
	 * Kept apart from `baseMap` on purpose. Which two a diver flicks between is a
	 * standing preference, and what is under the chart right now is where they
	 * happen to be in it; letting the picker write this would mean every look at
	 * a third map quietly rewrote the toggle.
	 */
	quickToggle = $state<QuickPair>(DEFAULT_QUICK_PAIR);

	readonly print = new PrintState();

	/** What the print path needs from the live map, and nothing more. */
	get live(): LiveView {
		return {
			centre: this.centre,
			bearing: this.bearing,
			layers: [...this.visible],
			isobaths: this.isobaths,
			groundLayer: this.groundLayer,
			smoothed: this.smoothed
		};
	}
	locale = $state<Locale>('ca');

	/**
	 * Which settings section is open, and which feature is selected. Both are
	 * sheets competing for the same screen on a phone, so they live together and
	 * opening either closes the other.
	 */
	panelOpen = $state<PanelSection | undefined>(undefined);
	selection = $state<FeaturePick | undefined>(undefined);

	/** Live camera, mirrored from the map so the crop overlay can size itself. */
	centre = $state<LngLat>({ lng: 3.2165, lat: 41.9275 });
	zoom = $state(13.4);
	bearing = $state(0);

	/** The sheet being framed. Its centre follows the map, so dragging frames it. */
	card = $state<DiveCard>(newCard({ lng: 3.2165, lat: 41.9275 }, 'Sense nom'));

	/** Set once the map has loaded its first tiles, so the shell can stop showing skeletons. */
	ready = $state(false);

	/**
	 * Whether the patch on screen is still arriving, after the first load is done.
	 *
	 * Water the survey never reached is painted with a hatch, and a diver had no
	 * way to tell that from tiles that had not landed yet. Written by MapView from
	 * MapLibre's own answer, never guessed here.
	 */
	tilesLoading = $state(false);

	/**
	 * Whether an archive the patch on screen is drawn from would not open.
	 *
	 * The badge above answers "is it still coming". This is the same question one
	 * step on, and the answer a diver cannot get anywhere else: water the survey
	 * never reached and water whose archive failed are drawn identically, and they
	 * mean opposite things. Written by `watchArchives` from what the map says about
	 * its own sources, so an archive nothing on screen draws from stays silent.
	 */
	archiveUnreadable = $state(false);

	/**
	 * Set once the `world` source has painted. The hillshade waits on it, because
	 * before the land is down it lights the DEM's nodata plane. See `style.ts`.
	 */
	worldPainted = $state(false);

	error = $state<string | undefined>(undefined);

	/** What this browser asked for, kept so `reset` knows what shipped means here. */
	readonly #negotiated: Locale;

	constructor(languages: readonly string[] = []) {
		this.#negotiated = negotiate(languages);
		this.locale = this.#negotiated;
	}

	/** Everything a saved configuration carries, read off the live map. */
	get configuration(): Configuration {
		return {
			layers: [...this.visible],
			ground: this.groundLayer,
			smoothed: this.smoothed,
			isobaths: this.isobaths,
			locale: this.locale,
			textures: this.textures,
			seabedPaint: this.seabedPaint,
			landPaint: this.landPaint,
			baseMap: this.baseMap,
			quickToggle: this.quickToggle,
			print: this.print.settings
		};
	}

	/** Where this tab is pointed. Per tab, so it is never part of a saved configuration. */
	get camera(): Camera {
		return { centre: this.centre, zoom: this.zoom, bearing: this.bearing };
	}

	apply(configuration: Configuration): void {
		this.visible.clear();
		this.#suspended.clear();
		this.#haloRaised = false;
		for (const id of configuration.layers) this.visible.add(id);
		this.groundLayer = configuration.ground;
		this.smoothed = configuration.smoothed;
		this.isobaths = configuration.isobaths;
		this.locale = configuration.locale;
		this.textures = configuration.textures;
		this.seabedPaint = configuration.seabedPaint;
		this.landPaint = configuration.landPaint;
		this.baseMap = configuration.baseMap;
		this.quickToggle = configuration.quickToggle;
		this.#mirrorBaseMap();
		// Through the print state's own transitions rather than over its fields, so a
		// stored pixel sheet carrying a scale ratio comes back framed by zoom. The
		// latitude is the live one because that is where the ratio has to hold.
		if (configuration.print !== undefined) this.print.apply(configuration.print, this.centre.lat);
		this.#settlePhoto();
	}

	/**
	 * Back to what the map ships with, leaving the camera and the language alone.
	 * Someone resetting their layers on a boat has not asked to be moved somewhere
	 * else, and has not asked to be spoken to in another language either: the
	 * language is its own panel and its own decision.
	 */
	reset(): void {
		this.apply({ ...shippedConfiguration(this.#negotiated), locale: this.locale });
	}

	openPanel(section: PanelSection | undefined): void {
		this.panelOpen = section;
		if (section !== undefined) this.selection = undefined;
	}

	select(feature: FeaturePick | undefined): void {
		this.selection = feature;
		if (feature !== undefined) this.panelOpen = undefined;
	}

	shows(id: LayerId): boolean {
		return this.visible.has(id);
	}

	/** Whether the photograph is holding this layer's switch down, so the panel can say why. */
	lockedByPhoto(id: LayerId): boolean {
		return this.visible.has('satellite') && SUSPENDED_BY_PHOTO.some((l) => l.id === id && l.locked);
	}

	toggle(id: LayerId): void {
		if (this.lockedByPhoto(id)) return;
		/*
		 * The old photograph switch is the base map picker with one option in it, and
		 * routing it through `setBaseMap` is what keeps the two from disagreeing.
		 * `satellite-costa` is the pair this switch has always meant. The whole branch
		 * goes when the picker replaces the switch and `satellite` leaves `LayerId`.
		 */
		if (id === 'satellite') {
			this.setBaseMap(this.baseMap === NO_BASE_MAP ? 'satellite-costa' : NO_BASE_MAP);
			return;
		}
		if (!this.visible.delete(id)) this.visible.add(id);
		// Flipping a suspended layer by hand is the diver taking it back, so there is
		// no longer anything of theirs to restore when the photograph goes away.
		this.#suspended.delete(id);
	}

	/** What was on before the photograph took it away, so it can go back exactly there. */
	readonly #suspended = new SvelteSet<LayerId>();

	/**
	 * Whether the photograph is the reason the contour outline is on.
	 *
	 * The mirror of `#suspended`, for a setting that is not a layer. The outline
	 * exists because a photograph puts the contours over ground nobody chose, so a
	 * base map raises it and taking that base map away lowers it again. A diver who
	 * drew the outline over the chart themselves, or who dropped it while the
	 * photograph was on, has said what they want, and this stays false so the next
	 * base map leaves their answer alone.
	 */
	#haloRaised = false;

	/** The outline switch, worked by hand. Whatever the photograph did to it stops counting. */
	toggleHalo(): void {
		this.#haloRaised = false;
		this.#drawHalo(!haloOf(this.isobaths).on);
	}

	#drawHalo(on: boolean): void {
		const paint = paintOf(this.isobaths);
		this.isobaths = { ...this.isobaths, paint: { ...paint, halo: { ...paint.halo, on } } };
	}

	#settleHalo(): void {
		if (this.visible.has('satellite')) {
			if (haloOf(this.isobaths).on) return;
			this.#haloRaised = true;
			this.#drawHalo(true);
			return;
		}
		if (!this.#haloRaised) return;
		this.#haloRaised = false;
		this.#drawHalo(false);
	}

	/**
	 * Bring the suspended layers in line with the photograph, in either direction.
	 *
	 * Restoring is not the same as turning on, which is the whole reason there is a
	 * set here instead of a pair of booleans. A diver who had the relief shading off
	 * before they asked for the photograph gets it back off, because they are the
	 * one who turned it off and nobody asked them to do it twice.
	 *
	 * Safe to run against any state, so `apply` can call it on a stored
	 * configuration written before the photograph suspended anything.
	 *
	 * The contour outline goes the other way, off by default and raised by the
	 * photograph, so `#settleHalo` runs first and reads the same flag.
	 */
	#settlePhoto(): void {
		this.#settleHalo();
		if (this.visible.has('satellite')) {
			this.#suspended.clear();
			for (const { id } of SUSPENDED_BY_PHOTO) {
				if (this.visible.delete(id)) this.#suspended.add(id);
			}
			return;
		}
		for (const id of this.#suspended) this.visible.add(id);
		this.#suspended.clear();
	}

	/**
	 * Put a base map under the chart, or take the last one away.
	 *
	 * `#settlePhoto` runs either way, because what the depth veil and the relief
	 * have to do with a borrowed map is the same question whichever one it is: both
	 * draw a second opinion over a picture that already shows what they draw.
	 */
	setBaseMap(id: BaseMapId): void {
		this.baseMap = id;
		this.#mirrorBaseMap();
		this.#settlePhoto();
	}

	/**
	 * One press of the corner toggle: the other of the diver's two base maps.
	 *
	 * Through `setBaseMap` like every other route in, so the photograph still
	 * suspends the depth veil and the relief on the way past.
	 */
	flipBaseMap(): void {
		this.setBaseMap(quickNext(this.quickToggle, this.baseMap));
	}

	/**
	 * Put a base map in the toggle's resting slot. Does not move the map: a diver
	 * setting up what the toggle flicks between has not asked to be shown either
	 * of them yet.
	 */
	chooseQuick(id: BaseMapId): void {
		this.quickToggle = withQuickChoice(this.quickToggle, id);
	}

	/**
	 * The `satellite` flag, brought in line with the chosen base map.
	 *
	 * Apart from `#settlePhoto` because `apply` runs that once at the end of a
	 * whole configuration, and running it twice against a base map that is on
	 * would clear the suspended set and then find nothing left in `visible` to put
	 * in it, which loses what the diver had on before.
	 */
	#mirrorBaseMap(): void {
		if (this.baseMap === NO_BASE_MAP) this.visible.delete('satellite');
		else this.visible.add('satellite');
	}

	toggleLabels(): void {
		this.isobaths = { ...this.isobaths, labels: !this.isobaths.labels };
	}

	/**
	 * Paint one class with one texture. Choosing the class's own texture clears the
	 * choice instead of storing a copy of it, so a class the diver put back follows
	 * the catalogue again rather than being pinned to whatever it says today.
	 */
	setTexture(seabed: SeabedClass, texture: string): void {
		const key = seabedKey(seabed);
		const kept = withoutChoice(this.textures, key);
		this.textures = texture === seabed.texture ? kept : { ...kept, [key]: texture };
	}

	clearTextures(): void {
		this.textures = NO_TEXTURE_CHOICES;
	}

	get anyTextureChosen(): boolean {
		return Object.keys(this.textures).length > 0;
	}

	/** The card as it would print right now: the live camera plus the sheet settings. */
	get framedCard(): DiveCard {
		return {
			...this.card,
			centre: this.centre,
			bearing: this.bearing,
			layers: [...this.visible],
			isobaths: this.isobaths
		};
	}
}
