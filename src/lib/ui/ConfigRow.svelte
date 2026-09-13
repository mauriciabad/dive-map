<script lang="ts">
	import Icon from './Icon.svelte';
	import Action from './controls/Action.svelte';
	import Chip from './controls/Chip.svelte';
	import Input from './controls/Input.svelte';
	import Note from './controls/Note.svelte';
	import type { ConfigRowMode } from './panel';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';

	/**
	 * One saved configuration. The name is the button: loading it is the thing a
	 * diver came here to do, so it gets the full width of the row rather than
	 * sharing it with three other controls at a third of the size each.
	 *
	 * Everything else lives behind the chevron, one row open at a time. Deleting
	 * asks first, because a named setup is work somebody did on a laptop at home
	 * and the tap that loses it would happen on a moving boat.
	 */

	interface Props {
		readonly name: string;
		readonly locale: Locale;
		readonly isDefault: boolean;
		/** The one this tab's settings came from, marked so the panel answers where you are. */
		readonly current: boolean;
		readonly mode: ConfigRowMode | undefined;
		readonly onload: () => void;
		readonly onmode: (next: ConfigRowMode | undefined) => void;
		readonly ondefault: () => void;
		readonly onrename: (next: string) => void;
		readonly ondelete: () => void;
	}

	const {
		name,
		locale,
		isDefault,
		current,
		mode,
		onload,
		onmode,
		ondefault,
		onrename,
		ondelete
	}: Props = $props();

	const id = $props.id();
	/** Seeded when the rename editor opens, so it never holds a name that has moved on. */
	let draft = $state('');
</script>

<div class="entry">
	<div class="row">
		<button
			type="button"
			class="pick"
			aria-current={current ? 'true' : undefined}
			title={t(locale, 'configsLoadNamed', { name })}
			onclick={onload}
		>
			<span class="name">{name}</span>
		</button>
		{#if isDefault}
			<Chip label={t(locale, 'configsDefault')} />
		{/if}
		<button
			type="button"
			class="more"
			aria-expanded={mode !== undefined}
			aria-controls={id}
			onclick={() => {
				onmode(mode === undefined ? 'actions' : undefined);
			}}
		>
			<Icon name="chevron" size={20} />
			<span class="visually-hidden">{t(locale, 'configsMore', { name })}</span>
		</button>
	</div>

	{#if mode !== undefined}
		<div class="open" {id}>
			{#if mode === 'actions'}
				<Action
					label={t(locale, isDefault ? 'configsClearDefault' : 'configsMakeDefault')}
					icon="tag"
					onclick={ondefault}
				/>
				<Action
					label={t(locale, 'configsRename')}
					icon="annotate"
					onclick={() => {
						draft = name;
						onmode('renaming');
					}}
				/>
				<Action
					label={t(locale, 'configsDelete')}
					icon="close"
					onclick={() => {
						onmode('confirm-delete');
					}}
				/>
			{:else if mode === 'renaming'}
				<Input
					label={t(locale, 'configsName')}
					value={draft}
					oncommit={(raw: string) => {
						draft = raw;
					}}
				/>
				<Action
					label={t(locale, 'configsRename')}
					tone="primary"
					onclick={() => {
						onrename(draft);
					}}
				/>
				<Action
					label={t(locale, 'configsCancel')}
					onclick={() => {
						onmode('actions');
					}}
				/>
			{:else}
				<Note tone="warn">{t(locale, 'configsDeleteWarn')}</Note>
				<Action label={t(locale, 'configsDeleteSure')} tone="danger" onclick={ondelete} />
				<Action
					label={t(locale, 'configsCancel')}
					onclick={() => {
						onmode('actions');
					}}
				/>
			{/if}
		</div>
	{/if}
</div>

<style>
	.entry {
		display: flex;
		flex-direction: column;
		border-radius: var(--control-radius);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}

	.pick {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		min-height: var(--spacing-touch);
		padding: 0.3rem 0.55rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink);
		font: inherit;
		font-size: var(--control-text);
		text-align: left;
		cursor: pointer;
		transition: background var(--control-ease);
	}

	.pick:hover {
		background: var(--control-hover);
	}

	/* The one the tab is working from, told in weight and hue rather than a badge. */
	.pick[aria-current] {
		color: var(--color-brass-300);
		font-weight: 700;
	}

	.name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.more {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--spacing-touch);
		height: var(--spacing-touch);
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink-dim);
		cursor: pointer;
		transition:
			background var(--control-ease),
			color var(--control-ease);
	}

	.more:hover {
		background: var(--control-hover);
		color: var(--control-ink);
	}

	.more :global(svg) {
		transition: rotate 160ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}

	.more[aria-expanded='true'] :global(svg) {
		rotate: 90deg;
	}

	.open {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.35rem 0.4rem 0.6rem;
		margin-bottom: 0.2rem;
		border-radius: var(--control-radius);
		background: var(--control-well);
	}

	@media (prefers-reduced-motion: reduce) {
		.more :global(svg) {
			transition: none;
		}
	}
</style>
