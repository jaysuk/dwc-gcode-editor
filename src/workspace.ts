/**
 * The workspace-shell data model: tabs, and up to two side-by-side groups (panes).
 *
 * Ported from two working, tested implementations rather than designed from scratch:
 * `Flexible-Layouts/src/widgets/ExplorerPanel.vue` (a flat tab list, one active tab, on-demand
 * mount) and `Duet3D/DuetWebControl` PR #517 (github.com/jaysuk, open at the time of writing),
 * which extends that same idea to two panes via a `groupId` tag on each tab rather than
 * restructuring into per-pane arrays. This module is that same shape, generalised: a tab's content
 * is an opaque, host-supplied payload (`data: T`) — this package has no opinion on whether a tab
 * holds a file path, a directory listing, or anything else. A host renders `WorkspaceState` with
 * its own tab strip / split-pane chrome; this module only owns the state transitions.
 *
 * Pure and immutable: every function returns a new `WorkspaceState`, never mutates its argument —
 * the natural shape for a Vue host to hold in a `ref` and replace on each change, and the easiest
 * to give real test coverage to.
 */

export type GroupId = 1 | 2;
export const PRIMARY_GROUP: GroupId = 1;
export const SECONDARY_GROUP: GroupId = 2;

export interface WorkspaceTab<T> {
	readonly id: number;
	readonly groupId: GroupId;
	readonly dirty: boolean;
	readonly data: T;
}

export interface WorkspaceGroup {
	readonly id: GroupId;
	/** Null only when a group has (transiently) no tabs — see `closeTab`'s doc comment. */
	readonly activeTabId: number | null;
}

export interface WorkspaceState<T> {
	readonly tabs: ReadonlyArray<WorkspaceTab<T>>;
	/** Length 1 (no split) or 2 (split), `PRIMARY_GROUP` first. */
	readonly groups: ReadonlyArray<WorkspaceGroup>;
	readonly focusedGroupId: GroupId;
	/** Fraction of the available width the primary pane occupies, meaningful only when split.
	 *  Persisted by the host the same way `cacheStore.explorerSplitRatio` is in DWC core. */
	readonly splitRatio: number;
	/** Monotonic id source, private to this module's own functions. */
	readonly nextId: number;
}

const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;
const DEFAULT_SPLIT_RATIO = 0.5;

function group<T>(state: WorkspaceState<T>, id: GroupId): WorkspaceGroup {
	const g = state.groups.find((x) => x.id === id);
	if (g === undefined) throw new Error(`No such group: ${id}`);
	return g;
}

function replaceGroup<T>(state: WorkspaceState<T>, updated: WorkspaceGroup): WorkspaceState<T> {
	return { ...state, groups: state.groups.map((g) => (g.id === updated.id ? updated : g)) };
}

/** Tabs belonging to one group, in their stored order. */
export function tabsInGroup<T>(state: WorkspaceState<T>, groupId: GroupId): ReadonlyArray<WorkspaceTab<T>> {
	return state.tabs.filter((t) => t.groupId === groupId);
}

/** The tab a group is currently showing, or null if the group has none (see `closeTab`). */
export function activeTab<T>(state: WorkspaceState<T>, groupId: GroupId): WorkspaceTab<T> | null {
	const g = group(state, groupId);
	return g.activeTabId === null ? null : (state.tabs.find((t) => t.id === g.activeTabId) ?? null);
}

/** A single-pane workspace with one tab holding `data`. */
export function createWorkspace<T>(data: T): WorkspaceState<T> {
	const id = 1;
	return {
		tabs: [{ id, groupId: PRIMARY_GROUP, dirty: false, data }],
		groups: [{ id: PRIMARY_GROUP, activeTabId: id }],
		focusedGroupId: PRIMARY_GROUP,
		splitRatio: DEFAULT_SPLIT_RATIO,
		nextId: id + 1,
	};
}

/**
 * Open a new tab holding `data`, in `groupId` (default: the currently focused group), and make it
 * that group's active tab and the workspace's focused group.
 */
export function openTab<T>(state: WorkspaceState<T>, data: T, groupId: GroupId = state.focusedGroupId): WorkspaceState<T> {
	const id = state.nextId;
	const tab: WorkspaceTab<T> = { id, groupId, dirty: false, data };
	const next = replaceGroup({ ...state, tabs: [...state.tabs, tab], nextId: id + 1 }, { id: groupId, activeTabId: id });
	return { ...next, focusedGroupId: groupId };
}

/**
 * Close a tab. If it was its group's active tab, activate a sensible sibling — the next tab, then
 * the previous one, mirroring the fallback-selection logic `Duet3D/DuetWebControl`'s Explorer page
 * already uses for exactly this. A group is allowed to reach zero tabs (its `activeTabId` becomes
 * null) rather than this function silently refusing or inventing a placeholder tab — a host that
 * never wants an empty pane enforces "always ≥1 tab" itself (as `ExplorerPanel.vue`'s own
 * `isLastBrowserTab`/`isLastDirectoryTab` disable the close button for exactly this), the same
 * separation of concerns as the rest of this module. `closeSplit` is what removes an empty second
 * group; this function never removes a group by itself.
 */
export function closeTab<T>(state: WorkspaceState<T>, tabId: number): WorkspaceState<T> {
	const closed = state.tabs.find((t) => t.id === tabId);
	if (closed === undefined) return state;

	const siblings = tabsInGroup(state, closed.groupId);
	const index = siblings.findIndex((t) => t.id === tabId);
	const fallback = siblings[index + 1] ?? siblings[index - 1] ?? null;

	const tabs = state.tabs.filter((t) => t.id !== tabId);
	const g = group(state, closed.groupId);
	const nextActive = g.activeTabId === tabId ? (fallback?.id ?? null) : g.activeTabId;
	return replaceGroup({ ...state, tabs }, { id: closed.groupId, activeTabId: nextActive });
}

/** Activate a tab and focus its group — the single entry point for both a plain tab click and the
 *  "which pane last had focus" tracking every other operation here keys off. */
export function setActiveTab<T>(state: WorkspaceState<T>, tabId: number): WorkspaceState<T> {
	const tab = state.tabs.find((t) => t.id === tabId);
	if (tab === undefined) return state;
	const next = replaceGroup(state, { id: tab.groupId, activeTabId: tabId });
	return { ...next, focusedGroupId: tab.groupId };
}

export function setDirty<T>(state: WorkspaceState<T>, tabId: number, dirty: boolean): WorkspaceState<T> {
	return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, dirty } : t)) };
}

/** Move a tab to a different group (drag-and-drop between panes), making it active there. Reorders
 *  within the same group when `beforeTabId` is given and `tabId` is already in `groupId`. */
export function moveTab<T>(
	state: WorkspaceState<T>,
	tabId: number,
	groupId: GroupId,
	beforeTabId: number | null = null,
): WorkspaceState<T> {
	const tab = state.tabs.find((t) => t.id === tabId);
	if (tab === undefined) return state;

	const fromGroupId = tab.groupId;
	const without = state.tabs.filter((t) => t.id !== tabId);
	const moved: WorkspaceTab<T> = tab.groupId === groupId ? tab : { ...tab, groupId };
	const insertAt = beforeTabId === null ? -1 : without.findIndex((t) => t.id === beforeTabId);
	const tabs = insertAt < 0
		? [...without, moved]
		: [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];

	let next: WorkspaceState<T> = { ...state, tabs };
	next = replaceGroup(next, { id: groupId, activeTabId: tabId });
	if (fromGroupId !== groupId) {
		const oldActive = group(state, fromGroupId).activeTabId;
		if (oldActive === tabId) {
			const remaining = tabsInGroup(next, fromGroupId);
			next = replaceGroup(next, { id: fromGroupId, activeTabId: remaining[0]?.id ?? null });
		}
	}
	return { ...next, focusedGroupId: groupId };
}

/** Whether `splitRight` may be called: exactly one group, with at least two tabs to split from —
 *  matching PR #517's own "Enabled once there are 2+ tabs to split from". */
export function canSplit<T>(state: WorkspaceState<T>): boolean {
	return state.groups.length === 1 && state.tabs.length >= 2;
}

/** Create the second pane, moving the currently-active tab of the primary pane into it — PR #517's
 *  "Split right" button. No-op if `canSplit` is false. */
export function splitRight<T>(state: WorkspaceState<T>): WorkspaceState<T> {
	if (!canSplit(state)) return state;
	const moving = activeTab(state, PRIMARY_GROUP);
	if (moving === null) return state;

	const primarySiblings = tabsInGroup(state, PRIMARY_GROUP);
	const index = primarySiblings.findIndex((t) => t.id === moving.id);
	const newPrimaryActive = primarySiblings[index + 1] ?? primarySiblings[index - 1] ?? null;

	const tabs = state.tabs.map((t) => (t.id === moving.id ? { ...t, groupId: SECONDARY_GROUP } : t));
	return {
		...state,
		tabs,
		groups: [
			{ id: PRIMARY_GROUP, activeTabId: newPrimaryActive?.id ?? null },
			{ id: SECONDARY_GROUP, activeTabId: moving.id },
		],
		focusedGroupId: SECONDARY_GROUP,
	};
}

/** Merge the secondary pane's tabs back into the primary pane and remove the split. No-op if not
 *  currently split. */
export function closeSplit<T>(state: WorkspaceState<T>): WorkspaceState<T> {
	if (state.groups.length < 2) return state;
	const secondaryActive = activeTab(state, SECONDARY_GROUP);
	const tabs = state.tabs.map((t) => (t.groupId === SECONDARY_GROUP ? { ...t, groupId: PRIMARY_GROUP } : t));
	return {
		...state,
		tabs,
		groups: [{ id: PRIMARY_GROUP, activeTabId: secondaryActive?.id ?? group(state, PRIMARY_GROUP).activeTabId }],
		focusedGroupId: PRIMARY_GROUP,
	};
}

/** Set the primary pane's width fraction, clamped so neither pane can be dragged to nothing. */
export function setSplitRatio<T>(state: WorkspaceState<T>, ratio: number): WorkspaceState<T> {
	const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
	return { ...state, splitRatio: clamped };
}
