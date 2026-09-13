<script lang="ts">
	import { untrack } from 'svelte';
	import ConfigRow from './ConfigRow.svelte';
	import Panel from './Panel.svelte';
	import Action from './controls/Action.svelte';
	import Field from './controls/Field.svelte';
	import Input from './controls/Input.svelte';
	import Note from './controls/Note.svelte';
	import Readout from './controls/Readout.svelte';
	import { type ConfigRowMode, PANEL_ID } from './panel';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import { storageUsage, type StorageUsage } from '$lib/offline/areas';
	import type { ClearScope } from '$lib/offline/cache-names';
	import { clearCaches, formatBytes } from '$lib/offline/maintenance';
	import { updates, type UpdateCheck } from '$lib/offline/updates.svelte';
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
	 *
	 * A third kind sits under both: what the browser is holding offline. It is
	 * here because this is the panel somebody opens when the map is behaving
	 * strangely, and issue #46 was twice a caching bug that could be neither seen
	 * nor cured from inside the app.
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

	const ANSWERED: Record<UpdateCheck, MessageKey> = {
		current: 'updateCurrent',
		coming: 'updateComing',
		failed: 'updateFailed',
		unsupported: 'updateUnsupported'
	};

	/**
	 * What the offline half of the panel is doing, at most one thing at a time.
	 *
	 * Both clears stop at `asking` before they run. The map data is a download
	 * somebody may be a long way from being able to make again, and the saved
	 * areas are the trip itself, so neither goes on a first tap.
	 */
	type Care =
		| { readonly task: 'update' }
		| { readonly task: ClearScope; readonly step: 'asking' | 'clearing' };

	let care = $state<Care | undefined>(undefined);
	// Undefined until the first estimate comes back, null where the browser has none.
	let space = $state<StorageUsage | null | undefined>(undefined);
	let answered = $state<MessageKey | undefined>(undefined);
	let cleared = $state<MessageKey | undefined>(undefined);

	const working = $derived(
		care !== undefined && (care.task === 'update' || care.step === 'clearing')
	);

	const readSpace = async (): Promise<void> => {
		space = await storageUsage().catch(() => null);
	};

	$effect(() => {
		void readSpace();
	});

	const check = async (): Promise<void> => {
		care = { task: 'update' };
		answered = undefined;
		const answer = await updates.check();
		care = undefined;
		answered = ANSWERED[answer];
	};

	/**
	 * The number is read again afterwards rather than a freed total being worked
	 * out from the difference. Chrome was still counting the deleted caches a
	 * minute and a reload later, so a diver told "5 MB freed" would be reading a
	 * figure the browser itself disagrees with. What the copy promises instead is
	 * what the caches can prove: the data went and the saved areas did not.
	 */
	const clear = async (scope: ClearScope): Promise<void> => {
		care = { task: scope, step: 'clearing' };
		cleared = undefined;
		try {
			await clearCaches(scope);
		} catch {
			care = undefined;
			cleared = 'storageClearFailed';
			return;
		}
		if (scope === 'everything') {
			// The worker goes with them, so the load below installs one from scratch
			// and precaches the whole shell rather than refilling it a file at a time.
			await updates.forget();
			location.reload();
			return;
		}
		await readSpace();
		care = undefined;
		cleared = 'storageCleared';
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

	<Field label={t(view.locale, 'updateSection')}>
		<Action
			label={t(view.locale, care?.task === 'update' ? 'updateChecking' : 'updateCheck')}
			icon="reset"
			busy={care?.task === 'update'}
			disabled={working}
			onclick={() => {
				void check();
			}}
		/>
		<div role="status" aria-live="polite">
			{#if answered !== undefined}
				<Note tone={answered === 'updateCurrent' ? 'quiet' : 'warn'}>
					{t(view.locale, answered)}
				</Note>
			{/if}
		</div>
		<Note>{t(view.locale, 'updateCheckHint')}</Note>
	</Field>

	<Field label={t(view.locale, 'storageSection')}>
		{#if space === null}
			<Note>{t(view.locale, 'storageUnknown')}</Note>
		{:else if space !== undefined}
			<Readout
				rows={[
					{ label: t(view.locale, 'storageUsed'), value: formatBytes(space.used, view.locale) },
					{ label: t(view.locale, 'storageLimit'), value: formatBytes(space.quota, view.locale) }
				]}
			/>
			<Note>{t(view.locale, space.persisted ? 'storageKept' : 'storageAtRisk')}</Note>
		{/if}

		<div role="status" aria-live="polite">
			{#if cleared !== undefined}
				<Note tone={cleared === 'storageCleared' ? 'quiet' : 'warn'}>
					{t(view.locale, cleared)}
				</Note>
			{/if}
		</div>

		{#if care?.task === 'map-data' && care.step === 'asking'}
			<Note tone="warn">{t(view.locale, 'storageClearMapWarn')}</Note>
			<Action
				label={t(view.locale, 'storageClearMapSure')}
				tone="danger"
				onclick={() => {
					void clear('map-data');
				}}
			/>
			<Action
				label={t(view.locale, 'configsCancel')}
				onclick={() => {
					care = undefined;
				}}
			/>
		{:else}
			<Action
				label={t(view.locale, care?.task === 'map-data' ? 'storageClearing' : 'storageClearMap')}
				icon="trash"
				busy={care?.task === 'map-data'}
				disabled={working}
				onclick={() => {
					care = { task: 'map-data', step: 'asking' };
				}}
			/>
			<Note>{t(view.locale, 'storageClearMapHint')}</Note>
		{/if}

		{#if care?.task === 'everything' && care.step === 'asking'}
			<Note tone="warn">{t(view.locale, 'storageClearAllWarn')}</Note>
			<Action
				label={t(view.locale, 'storageClearAllSure')}
				tone="danger"
				onclick={() => {
					void clear('everything');
				}}
			/>
			<Action
				label={t(view.locale, 'configsCancel')}
				onclick={() => {
					care = undefined;
				}}
			/>
		{:else}
			<Action
				label={t(view.locale, care?.task === 'everything' ? 'storageClearing' : 'storageClearAll')}
				icon="trash"
				busy={care?.task === 'everything'}
				disabled={working}
				onclick={() => {
					care = { task: 'everything', step: 'asking' };
				}}
			/>
			<Note>{t(view.locale, 'storageClearAllHint')}</Note>
		{/if}
	</Field>
</Panel>

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
</style>
