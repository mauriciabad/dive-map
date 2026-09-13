<script lang="ts">
	import Icon from '../Icon.svelte';
	import Toggle from './Toggle.svelte';
	import type { IsobathStyle } from '$lib/domain/card';
	import {
		contourColour,
		contourDepths,
		depthMarks,
		metresLabel,
		paintOf,
		paintedBands,
		readableInk,
		withColour,
		withEdgeOwnColour,
		withEmphasis,
		withMark,
		withMarkAt,
		withoutMark
	} from '$lib/domain/isobaths';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * The isobaths themselves, stacked the way the seabed stacks them: the surface
	 * at the top, the maximum depth at the bottom, every contour the map is drawing
	 * in the colour the map is drawing it. A diver picks a depth out by pressing
	 * the line, and paints it by pressing the swatch on the end of it.
	 *
	 * A ruler rather than a list of numbers because the thing being configured is a
	 * picture. Which band a colour lands on depends on which way the paint runs,
	 * and no wording of that is as clear as seeing forty lines change colour.
	 */

	interface Props {
		readonly locale: Locale;
		readonly style: IsobathStyle;
		/** The map's own zoom. An automatic interval is a function of it. */
		readonly zoom: number;
		readonly onchange: (next: IsobathStyle) => void;
	}

	const { locale, style, zoom, onchange }: Props = $props();

	/**
	 * How tall a metre is drawn. Enough that two marks five metres apart, which is
	 * the closest pair a dive plan actually uses, each keep a row a thumb can land
	 * on. The panel scrolls; a ruler that fits the screen by squashing 80 m into
	 * one screenful is a ruler nothing can be pressed on.
	 */
	const PER_METRE_REM = 0.34;
	const SHORTEST_REM = 16;
	const TALLEST_REM = 40;

	let ruler = $state<HTMLElement | undefined>(undefined);
	/** The row a press has raised, so it stays on top of the rows it overlaps. */
	let raised = $state<number | undefined>(undefined);
	/** A mark moved by the keyboard is a new element. Put the focus back on it. */
	let refocus = $state<number | undefined>(undefined);

	const bands = $derived(paintedBands(style));
	const marks = $derived(new Map(depthMarks(style).map((mark) => [mark.depthM, mark])));
	/**
	 * The surface is always on the ruler, whether or not it is marked, because it
	 * is the top of the thing. The map draws the shoreline there under its own
	 * switch, and pressing this line is the only way 0 m ever becomes a mark.
	 */
	const contours = $derived.by(() => {
		const drawn = contourDepths(style, zoom);
		return drawn.includes(0) ? drawn : [0, ...drawn];
	});
	const edge = $derived(depthMarks(style).find((mark) => mark.noBand));
	const ownEdge = $derived(paintOf(style).edgeOwnColour);

	const height = $derived(
		Math.min(TALLEST_REM, Math.max(SHORTEST_REM, style.maxDepthM * PER_METRE_REM))
	);

	const at = (depthM: number): number =>
		style.maxDepthM <= 0 ? 0 : (depthM / style.maxDepthM) * 100;

	const taken = (depthM: number): boolean => style.emphasised.includes(depthM);

	/** Held so a panel closed mid-drag takes its window listeners with it. */
	let release: (() => void) | undefined;

	const startDrag = (event: PointerEvent, depthM: number): void => {
		if (event.button !== 0 || ruler === undefined) return;
		const box = ruler.getBoundingClientRect();
		// Where the line is now, which is not where it started once it has moved.
		let held = depthM;
		const move = (moved: PointerEvent): void => {
			const wanted = Math.round(((moved.clientY - box.top) / box.height) * style.maxDepthM);
			const to = Math.min(style.maxDepthM, Math.max(0, wanted));
			if (to === held || taken(to)) return;
			const from = held;
			held = to;
			raised = to;
			onchange(withMarkAt(style, from, to));
		};
		const stop = (): void => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
			release = undefined;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
		release = stop;
		event.preventDefault();
	};

	$effect(() => () => {
		release?.();
	});

	const nudge = (event: KeyboardEvent, depthM: number): void => {
		const by = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[event.key];
		if (by === undefined) return;
		event.preventDefault();
		const to = Math.min(style.maxDepthM, Math.max(0, depthM + by));
		if (to === depthM || taken(to)) return;
		refocus = to;
		raised = to;
		onchange(withMarkAt(style, depthM, to));
	};

	$effect(() => {
		const wanted = refocus;
		if (wanted === undefined) return;
		refocus = undefined;
		ruler?.querySelector<HTMLElement>(`[data-grip="${wanted}"]`)?.focus();
	});
</script>

<div
	class="ruler"
	role="group"
	aria-label={t(locale, 'emphasised')}
	style:--reach="{height}rem"
	bind:this={ruler}
>
	<div class="well" aria-hidden="true"></div>

	{#each contours as depth (depth)}
		{@const mark = marks.get(depth)}
		{@const ink = contourColour(bands, depth)}
		{#if mark === undefined}
			<button
				type="button"
				class="line"
				style:--at="{at(depth)}%"
				style:--ink={ink}
				title={t(locale, 'markAdd', { depth })}
				onclick={() => {
					raised = depth;
					onchange(withMark(style, depth));
				}}
			>
				<span class="gutter"><Icon name="plus" size={15} /></span>
				<span class="stroke"></span>
				<span class="visually-hidden">{t(locale, 'markAdd', { depth })}</span>
			</button>
		{:else}
			<div
				class={['line', 'marked', { raised: raised === depth, thin: !mark.emphasised }]}
				style:--at="{at(depth)}%"
				style:--ink={ink}
				style:--paint={mark.colour}
				style:--pencil={readableInk(mark.colour)}
			>
				<span class="gutter">
					<button
						type="button"
						class="grip"
						role="slider"
						tabindex="0"
						data-grip={depth}
						aria-label={t(locale, 'markMove', { depth })}
						aria-valuemin={0}
						aria-valuemax={style.maxDepthM}
						aria-valuenow={depth}
						aria-valuetext={metresLabel(depth)}
						onpointerdown={(event: PointerEvent) => {
							startDrag(event, depth);
						}}
						onkeydown={(event: KeyboardEvent) => {
							nudge(event, depth);
						}}
					>
						<Icon name="grip" size={15} />
					</button>
				</span>

				<span class="stroke"></span>

				<label class={['swatch', { hollow: mark.noBand && !ownEdge }]}>
					<input
						type="color"
						value={mark.colour}
						aria-label={t(locale, 'markColour', { depth })}
						oninput={(event) => {
							const picked = event.currentTarget.value;
							raised = depth;
							onchange(
								mark.noBand && !ownEdge
									? withEdgeOwnColour(withColour(style, depth, picked), true)
									: withColour(style, depth, picked)
							);
						}}
					/>
					<Icon name={mark.noBand && !ownEdge ? 'close' : 'annotate'} size={13} />
				</label>

				<button
					type="button"
					class="depth"
					onclick={() => {
						raised = raised === depth ? undefined : depth;
					}}
				>
					{metresLabel(depth)}
				</button>

				<span class="tools">
					<label class="tick" title={t(locale, 'markEmphasis', { depth })}>
						<input
							type="checkbox"
							checked={mark.emphasised}
							aria-label={t(locale, 'markEmphasis', { depth })}
							onchange={(event) => {
								onchange(withEmphasis(style, depth, event.currentTarget.checked));
							}}
						/>
					</label>
					<button
						type="button"
						class="drop"
						title={t(locale, 'markRemove', { depth })}
						onclick={() => {
							raised = undefined;
							onchange(withoutMark(style, depth));
						}}
					>
						<Icon name="trash" size={15} />
						<span class="visually-hidden">{t(locale, 'markRemove', { depth })}</span>
					</button>
				</span>
			</div>
		{/if}
	{/each}
</div>

{#if edge !== undefined}
	<Toggle
		label={t(locale, 'edgeOwnColour', { depth: edge.depthM })}
		pressed={ownEdge}
		onchange={() => {
			onchange(withEdgeOwnColour(style, !ownEdge));
		}}
	/>
{/if}

<style>
	.ruler {
		position: relative;
		height: var(--reach);
		/* Room for the rows at either end, which straddle the line they hang off. */
		margin-block: 1rem;
		/* The swatch and the number hang past the well, and the grip hangs before it. */
		--gutter: 1.5rem;
		--well: 7.5rem;
	}

	/*
	 * The water the contours are cut out of. Lighter than the panel behind it
	 * rather than darker, because every line drawn on it is a light on a dark
	 * ground and the ones between the marks are the quiet ones.
	 */
	.well {
		position: absolute;
		inset: -0.45rem auto -0.45rem var(--gutter);
		width: var(--well);
		border: 1px solid var(--ctrl-seam);
		border-radius: var(--control-radius);
		background: var(--control-well);
		box-shadow: var(--sunk);
	}

	/*
	 * Every contour sits at its own depth, which is the whole point, so the rows
	 * overlap wherever two are close. The order they overlap in is settled rather
	 * than left to what happens to be drawn last: a marked line is always over a
	 * metre contour, because a swatch two pixels from a plain line is a swatch
	 * that cannot be pressed, and the row under the pointer is over both.
	 */
	.line {
		position: absolute;
		inset: var(--at) auto auto 0;
		display: flex;
		align-items: center;
		z-index: 1;
		/* A plain contour stops at the edge of the well, leaving the controls of a
		   marked line beside it to their own space. */
		width: calc(var(--gutter) + var(--well));
		padding: 0;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink-dim);
		font: inherit;
		translate: 0 -50%;
		transition: background var(--control-ease);
	}

	button.line {
		cursor: pointer;
	}

	.line.marked {
		width: 100%;
		z-index: 2;
	}

	.line:hover,
	.line:focus-within {
		background: var(--control-hover);
		z-index: 3;
	}

	.line.raised {
		background: var(--control-hover);
		z-index: 4;
	}

	.gutter {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--gutter);
		height: 1.5rem;
		color: var(--control-ink-off);
		opacity: 0;
		transition: opacity var(--control-ease);
	}

	.marked .gutter {
		opacity: 1;
	}

	.line:hover .gutter,
	.line:focus-within .gutter,
	.line.raised .gutter {
		opacity: 1;
		color: var(--control-ink-dim);
	}

	.grip {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: grab;
		touch-action: none;
	}

	.grip:active {
		cursor: grabbing;
	}

	/*
	 * The line as the map draws it: the marked ones heavy, the metre contours
	 * between them quiet enough not to become a mat. The same two weights the
	 * style paints, so the ruler is a reading of the map rather than a diagram
	 * of it.
	 */
	.stroke {
		flex: none;
		width: var(--well);
		height: 3px;
		border-radius: 2px;
		background: var(--ink);
		opacity: 0.62;
	}

	.marked .stroke {
		/* Past the well, up to the swatch, so a marked contour reads as one object. */
		width: calc(var(--well) + 0.55rem);
		height: 5px;
		opacity: 1;
	}

	.marked.thin .stroke {
		height: 3px;
		opacity: 0.75;
	}

	.line:hover .stroke {
		opacity: 1;
	}

	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 1.65rem;
		height: 1.35rem;
		border-radius: 0.5rem 0.9rem 0.9rem 0.5rem;
		background: var(--paint);
		color: var(--pencil);
		cursor: pointer;
	}

	/* No band reaches this line, so there is nothing of its own to show. */
	.swatch.hollow {
		background: transparent;
		border: 1px solid var(--control-rim);
		color: var(--control-ink-off);
	}

	.swatch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		opacity: 0;
		cursor: pointer;
	}

	.depth {
		flex: none;
		min-width: 3.3rem;
		padding: 0.2rem 0.35rem;
		border: 0;
		background: transparent;
		color: var(--control-ink);
		font: inherit;
		font-size: var(--control-text);
		font-variant-numeric: tabular-nums;
		text-align: left;
		cursor: pointer;
	}

	.thin .depth {
		color: var(--control-ink-dim);
	}

	/*
	 * Always on show. They were revealed on hover, which is a gesture a boat does
	 * not have: on a phone the tick and the bin were there and nothing said so.
	 */
	.tools {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		flex: none;
	}

	.tick,
	.drop {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--control-ink-dim);
		border-radius: var(--control-radius);
		cursor: pointer;
	}

	.drop:hover {
		color: var(--color-hazard);
	}

	.tick input {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--control-on);
		cursor: pointer;
	}
</style>
