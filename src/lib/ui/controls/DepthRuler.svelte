<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import Icon from '../Icon.svelte';
	import type { IsobathStyle } from '$lib/domain/card';
	import {
		contourColour,
		depthMarks,
		metresLabel,
		paintedBands,
		readableInk,
		rulerDepths,
		withColour,
		withEmphasis,
		withMark,
		withMarkAt,
		withoutMark
	} from '$lib/domain/isobaths';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * The isobaths themselves, stacked the way the seabed stacks them: the surface
	 * at the top, the deepest water the archive holds at the bottom, every contour
	 * in the colour the map is drawing it. A diver picks a depth out by pressing the
	 * line, paints it by pressing the swatch on the end of it, and says where the
	 * map stops by dragging the dashed line down the same rows.
	 *
	 * A ruler rather than a list of numbers because the thing being configured is a
	 * picture. Which band a colour lands on depends on which way the paint runs, and
	 * no wording of that is as clear as seeing forty lines change colour.
	 */

	interface Props {
		readonly locale: Locale;
		readonly style: IsobathStyle;
		readonly onchange: (next: IsobathStyle) => void;
	}

	const { locale, style, onchange }: Props = $props();

	/**
	 * How tall one row is drawn, not how tall a metre is.
	 *
	 * The ruler used to place each line at its share of the maximum depth, which
	 * made the spacing a picture of the water rather than of the list. Once the
	 * contours past 80 m coarsened to fives, that stretched the deep half into
	 * five times the gap for the same number of rows, with a metre of ink and
	 * nothing to press between them. Rows are evenly spaced now: every line is
	 * one thumb tall wherever it sits, and the ruler is as long as it has rows.
	 */
	const PER_ROW_REM = 0.34;
	const SHORTEST_REM = 16;
	const TALLEST_REM = 85;

	/** How long the cut takes to reach a depth it was sent to rather than dragged to. */
	const CUT_MS = 180;

	/** A map cut at the surface draws no water at all, so the cut stops short of it. */
	const SHALLOWEST_CUT_M = 5;

	const NUDGE: Readonly<Record<string, number>> = {
		ArrowUp: -1,
		ArrowDown: 1,
		PageUp: -5,
		PageDown: 5
	};

	let ruler = $state<HTMLElement | undefined>(undefined);
	/** The row a press has raised, so it stays on top of the rows it overlaps. */
	let raised = $state<number | undefined>(undefined);
	/** A mark moved by the keyboard is a new element. Put the focus back on it. */
	let refocus = $state<number | undefined>(undefined);
	/** The cut is under a finger, so it belongs where the finger is and nowhere else. */
	let holding = $state(false);

	const bands = $derived(paintedBands(style));
	const marks = $derived(new Map(depthMarks(style).map((mark) => [mark.depthM, mark])));
	const contours = $derived(rulerDepths(style));
	const deepest = $derived(contours.at(-1) ?? 0);
	const height = $derived(
		Math.min(TALLEST_REM, Math.max(SHORTEST_REM, contours.length * PER_ROW_REM))
	);

	/**
	 * A depth's share of the list, not of the water. A depth the list does not hold
	 * sits between the two rows it falls between, which is where the cut lands after
	 * a keystroke moves it by a metre through water the rows only count in fives.
	 */
	const at = (depthM: number): number => {
		const last = contours.length - 1;
		if (last <= 0) return 0;
		const index = contours.indexOf(depthM);
		if (index >= 0) return (index / last) * 100;
		const under = contours.findLastIndex((row) => row < depthM);
		const from = contours[under];
		const to = contours[under + 1];
		if (from === undefined || to === undefined) return under < 0 ? 0 : 100;
		return ((under + (depthM - from) / (to - from)) / last) * 100;
	};

	/**
	 * The cut glides to a depth it was sent to, and sits exactly under the thumb
	 * while it is being dragged: a dashed line easing its way after the finger is a
	 * line that does not look dragged. Reduced motion takes the glide away, the same
	 * as `Fold` does with its slide.
	 *
	 * It tweens the depth rather than the position, so a row appearing under it
	 * cannot slide the line to a depth nobody asked for.
	 */
	const cut = Tween.of(() => style.maxDepthM, {
		duration: () => (holding || prefersReducedMotion.current ? 0 : CUT_MS),
		easing: cubicOut
	});

	const taken = (depthM: number): boolean => style.emphasised.includes(depthM);

	/** Held so a panel closed mid-drag takes its window listeners with it. */
	let release: (() => void) | undefined;

	/**
	 * Follows the pointer down the ruler and hands back the row under it. The same
	 * question whether a mark is being dragged or the cut is, so the same code.
	 */
	const follow = (
		event: PointerEvent,
		onRow: (depthM: number) => void,
		done?: () => void
	): boolean => {
		const box = ruler?.getBoundingClientRect();
		if (box === undefined) return false;
		/*
		 * The rows as they stand at the press. Moving a mark rewrites the list it is
		 * in, so reading `contours` during the drag would measure the pointer against
		 * a ruler that moved underneath it.
		 */
		const rows = [...contours];
		const move = (moved: PointerEvent): void => {
			const last = rows.length - 1;
			if (last <= 0) return;
			const wanted = Math.round(((moved.clientY - box.top) / box.height) * last);
			const row = rows[Math.min(last, Math.max(0, wanted))];
			if (row !== undefined) onRow(row);
		};
		const stop = (): void => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
			release = undefined;
			done?.();
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
		release = stop;
		event.preventDefault();
		return true;
	};

	const startDrag = (event: PointerEvent, depthM: number): void => {
		if (event.button !== 0) return;
		// Where the line is now, which is not where it started once it has moved.
		let held = depthM;
		follow(event, (to) => {
			if (to === held || taken(to)) return;
			const from = held;
			held = to;
			raised = to;
			onchange(withMarkAt(style, from, to));
		});
	};

	/**
	 * Where the map stops drawing. It cuts the ruler rather than cropping it: every
	 * row stays where it was and the ones past here are simply not on the map.
	 */
	const setCut = (depthM: number): void => {
		const to = Math.min(deepest, Math.max(SHALLOWEST_CUT_M, depthM));
		if (to === style.maxDepthM) return;
		onchange({ ...style, maxDepthM: to });
	};

	const startCut = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		holding = follow(event, setCut, () => {
			holding = false;
		});
	};

	$effect(() => () => {
		release?.();
	});

	const nudge = (event: KeyboardEvent, depthM: number): void => {
		const by = NUDGE[event.key];
		if (by === undefined) return;
		event.preventDefault();
		const to = Math.min(deepest, Math.max(0, depthM + by));
		if (to === depthM || taken(to)) return;
		refocus = to;
		raised = to;
		onchange(withMarkAt(style, depthM, to));
	};

	const nudgeCut = (event: KeyboardEvent): void => {
		const by = NUDGE[event.key];
		if (by === undefined) return;
		event.preventDefault();
		setCut(style.maxDepthM + by);
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
	style:--cut="{at(cut.current)}%"
	bind:this={ruler}
>
	<div class="well" aria-hidden="true"></div>

	{#each contours as depth (depth)}
		{@const mark = marks.get(depth)}
		{@const ink = contourColour(bands, depth)}
		{#if mark === undefined}
			<button
				type="button"
				class={['line', { past: depth > cut.current }]}
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
				class={[
					'line',
					'marked',
					{ raised: raised === depth, thin: !mark.emphasised, past: depth > cut.current }
				]}
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
						aria-valuemax={deepest}
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

				{#if mark.noBand}
					<!--
						A line no band reaches follows the band beside it, so there is no
						colour of its own to pick. Hollow and unpressable rather than absent,
						so the row keeps the shape every other row has.
					-->
					<span class="swatch hollow"><Icon name="close" size={13} /></span>
				{:else}
					<label class="swatch">
						<input
							type="color"
							value={mark.colour}
							aria-label={t(locale, 'markColour', { depth })}
							oninput={(event) => {
								raised = depth;
								onchange(withColour(style, depth, event.currentTarget.value));
							}}
						/>
						<Icon name="annotate" size={13} />
					</label>
				{/if}

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

	<div class="beyond" aria-hidden="true"></div>

	<!--
		The end of the map, drawn on the rows rather than taken out of them. It is the
		only control here that is not about one contour, so it gets a lane of its own
		down the left: a grip that shared the marks' column would cover whichever mark
		the cut happened to be sitting on.
	-->
	<div class="cut">
		<button
			type="button"
			class="hold"
			role="slider"
			tabindex="0"
			aria-label={t(locale, 'maxDepth')}
			aria-orientation="vertical"
			aria-valuemin={SHALLOWEST_CUT_M}
			aria-valuemax={deepest}
			aria-valuenow={style.maxDepthM}
			aria-valuetext={metresLabel(style.maxDepthM)}
			onpointerdown={startCut}
			onkeydown={nudgeCut}
		>
			<Icon name="grip" size={15} />
		</button>
		<span class="dash"></span>
		<span class="tag">{t(locale, 'rulerEnd')} {metresLabel(style.maxDepthM)}</span>
	</div>
</div>

<style>
	.ruler {
		position: relative;
		height: var(--reach);
		/* Room for the rows at either end, which straddle the line they hang off. */
		margin-block: 1rem;
		/* The cut's own column, left of everything a row owns. */
		--lane: 1.5rem;
		/* The swatch and the number hang past the well, and the grips hang before it. */
		--gutter: 3rem;
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
	 * Water past the cut: hatched rather than blacked out, the way a chart hatches
	 * ground it has nothing to say about. The rows underneath stay legible, because
	 * a mark below the cut is still a mark and still has to be draggable.
	 */
	.beyond {
		position: absolute;
		inset: var(--cut) auto -0.45rem var(--gutter);
		width: var(--well);
		border-radius: 0 0 var(--control-radius) var(--control-radius);
		background: repeating-linear-gradient(-45deg, transparent 0 4px, rgb(2 9 14 / 0.55) 4px 9px);
		pointer-events: none;
		z-index: 5;
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
		transition:
			background var(--control-ease),
			opacity var(--control-ease);
	}

	button.line {
		cursor: pointer;
	}

	.line.marked {
		width: 100%;
		z-index: 2;
	}

	/* Past the cut, so the map is not drawing it. Still here, still pressable. */
	.line.past {
		opacity: 0.5;
	}

	.line:hover,
	.line:focus-within {
		background: var(--control-hover);
		opacity: 1;
		z-index: 3;
	}

	.line.raised {
		background: var(--control-hover);
		opacity: 1;
		z-index: 4;
	}

	/* Right of the lane the cut runs in, so the two grips never land on each other. */
	.gutter {
		display: grid;
		place-items: center end;
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
		width: var(--lane);
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
		cursor: default;
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
		min-width: 3.1rem;
		padding: 0.2rem 0.3rem;
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

	/*
	 * Over every row, because it is the one thing here that is about all of them.
	 * Only the grip takes the pointer: the dash lies across ten contours and a diver
	 * pressing one of them means the contour.
	 */
	.cut {
		position: absolute;
		inset: var(--cut) auto auto 0;
		display: flex;
		align-items: center;
		width: calc(var(--gutter) + var(--well));
		translate: 0 -50%;
		pointer-events: none;
		z-index: 6;
	}

	.hold {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--lane);
		height: 1.6rem;
		padding: 0;
		border: 0;
		border-radius: var(--control-radius);
		background: var(--control-on);
		color: var(--control-on-ink);
		cursor: grab;
		pointer-events: auto;
		touch-action: none;
	}

	.hold:active {
		cursor: grabbing;
	}

	/*
	 * Carried on a dark edge, because it lies across whichever contours it lands
	 * between and the ruler paints those in every colour the ramp has. Brass on
	 * brass at 4 m is the one place it would otherwise disappear.
	 */
	.dash {
		flex: none;
		width: var(--well);
		height: 0;
		margin-left: calc(var(--gutter) - var(--lane));
		border-top: 2px dashed var(--control-on-rim);
		filter: drop-shadow(0 1px 0 rgb(2 9 14 / 0.85)) drop-shadow(0 -1px 0 rgb(2 9 14 / 0.85));
	}

	/*
	 * At the deep end of the dash, inside the well, where it can cover nothing but
	 * contour ink. Out past the well it would sit on a swatch every time the cut
	 * landed on a marked depth.
	 */
	.tag {
		position: absolute;
		top: 50%;
		right: 0;
		padding: 0.05rem 0.3rem;
		border-radius: var(--control-radius);
		background: var(--control-on);
		color: var(--control-on-ink);
		font-size: var(--control-label);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		translate: 0 -50%;
	}
</style>
