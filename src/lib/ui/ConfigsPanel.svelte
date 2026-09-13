<script lang="ts">
	import { untrack } from 'svelte';
	import ConfigRow from './ConfigRow.svelte';
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Field from './controls/Field.svelte';
	import Input from './controls/Input.svelte';
	import Note from './controls/Note.svelte';
	import { type ConfigRowMode, PANEL_ID } from './panel';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import { LIBRARY_LIMIT } from '$lib/state/configuration';
	import type { Configurations, Outcome, Refusal } from '$lib/state/configurations.svelte';
	import type { MapState } from '$lib/state/map-view.svelte';

	/**
	 * Two kinds of memory, told apart in the copy rather than in the code.
	 *
	 * This tab remembers itself, camera and all, and nobody asked it to. The
	 * named configurations are shared across tabs and sessions and change only
	 * when somebody types a name and presses save. Mixing the two is what would
	 * make a second tab drag the first one's view along with it, which is the
	 * thing the issue is really about.
	 */

	interface Props {
		readonly view: MapState;
		readonly configurations: Configurations;
		readonly onclose: () => void;
	}

	const { view, configurations, onclose }: Props = $props();

	const REFUSED: Record<Refusal, MessageKey> = {
		'no-name': 'configsNeedsName',
		'name-taken': 'configsNameTaken',
		full: 'configsFull',
		locked: 'configsNewer',
		refused: 'configsRefused'
	};

	interface Said {
		readonly key: MessageKey;
		readonly name: string;
		readonly wrong: boolean;
	}

	let row = $state<{ readonly name: string; readonly mode: ConfigRowMode } | undefined>(undefined);
	// Taken once: the field is a draft from here on, not a mirror of what is loaded.
	let draft = $state(untrack(() => configurations.from) ?? '');
	let said = $state<Said | undefined>(undefined);

	// Another tab may have saved something since this one booted, and may save
	// something else while the panel sits open.
	$effect(() => {
		configurations.refresh();
		return configurations.attach();
	});

	const modeOf = (name: string): ConfigRowMode | undefined =>
		row?.name === name ? row.mode : undefined;

	const say = (outcome: Outcome, done: MessageKey, name: string): boolean => {
		said = outcome.ok
			? { key: done, name, wrong: false }
			: { key: REFUSED[outcome.why], name, wrong: true };
		return outcome.ok;
	};

	const overwrites = $derived(configurations.has(draft.trim()));

	const save = (): void => {
		const name = draft.trim();
		if (say(configurations.save(name, view.configuration), 'configsStored', name)) {
			row = undefined;
		}
	};

	const load = (name: string): void => {
		const configuration = configurations.configurationNamed(name);
		if (configuration === undefined) return;
		view.apply(configuration);
		configurations.from = name;
		draft = name;
		row = undefined;
		said = { key: 'configsLoaded', name, wrong: false };
	};

	const reset = (): void => {
		view.reset();
		configurations.from = undefined;
		draft = '';
		said = { key: 'configsWasReset', name: '', wrong: false };
	};
</script>

<Panel
	id={PANEL_ID}
	title={t(view.locale, 'configs')}
	locale={view.locale}
	anchor="top-left"
	{onclose}
>
	<div role="status" aria-live="polite">
		{#if said !== undefined}
			<Note tone={said.wrong ? 'warn' : 'quiet'}>
				{t(view.locale, said.key, { name: said.name, n: LIBRARY_LIMIT })}
			</Note>
		{/if}
	</div>

	{#if configurations.problem !== undefined}
		<Field label={t(view.locale, 'configsSavedList')}>
			<Note tone="warn">
				{t(view.locale, configurations.problem === 'newer' ? 'configsNewer' : 'configsDamaged')}
			</Note>
			<Action
				label={t(view.locale, 'configsDiscard')}
				tone="danger"
				onclick={() => {
					configurations.discard();
					said = undefined;
				}}
			/>
		</Field>
	{:else}
		<Field label={t(view.locale, 'configsSavedList')}>
			{#if configurations.saved.length === 0}
				<Note>{t(view.locale, 'configsNone')}</Note>
			{:else}
				<div class="rows">
					{#each configurations.saved as entry (entry.name)}
						<ConfigRow
							name={entry.name}
							locale={view.locale}
							isDefault={configurations.openWith === entry.name}
							current={configurations.from === entry.name}
							mode={modeOf(entry.name)}
							onload={() => {
								load(entry.name);
							}}
							onmode={(mode: ConfigRowMode | undefined) => {
								row = mode === undefined ? undefined : { name: entry.name, mode };
							}}
							ondefault={() => {
								const on = configurations.openWith === entry.name;
								say(
									configurations.setOpenWith(on ? undefined : entry.name),
									on ? 'configsDefaultCleared' : 'configsDefaultSet',
									entry.name
								);
							}}
							onrename={(next: string) => {
								if (say(configurations.rename(entry.name, next), 'configsRenamed', next.trim())) {
									row = undefined;
								}
							}}
							ondelete={() => {
								if (say(configurations.remove(entry.name), 'configsDeleted', entry.name)) {
									row = undefined;
								}
							}}
						/>
					{/each}
				</div>
			{/if}
		</Field>
	{/if}

	<Field label={t(view.locale, 'configsSaveCurrent')}>
		<Input
			label={t(view.locale, 'configsName')}
			value={draft}
			placeholder={t(view.locale, 'configsNameExample')}
			oncommit={(raw: string) => {
				draft = raw;
			}}
		/>
		<Action
			label={t(view.locale, overwrites ? 'configsOverwrite' : 'configsSave')}
			tone="primary"
			disabled={configurations.locked}
			onclick={save}
		/>
		<Note>{t(view.locale, 'configsWhatIsSaved')}</Note>
	</Field>

	<Field label={t(view.locale, 'configsThisTab')}>
		<Note>
			{configurations.from === undefined
				? t(view.locale, 'configsUnsaved')
				: t(view.locale, 'configsFrom', { name: configurations.from })}
		</Note>
		<Note>{t(view.locale, 'configsThisTabHint')}</Note>
		<Action label={t(view.locale, 'configsReset')} icon="reset" onclick={reset} />
		<Note>{t(view.locale, 'configsResetHint')}</Note>
	</Field>
</Panel>

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
</style>
