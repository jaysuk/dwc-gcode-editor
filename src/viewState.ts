/**
 * Per-file view-state persistence — the cursor/selection and scroll position of a file, remembered
 * across closing and reopening it. Ported in behaviour from Fluidd's `FileEditor.vue`, which calls
 * Monaco's `saveViewState()`/`restoreViewState()` keyed per file and stores the result in
 * `localStorage`, `sessionStorage` or nowhere (its `restoreViewState: 'local' | 'session' | 'off'`
 * setting). CM6 has no equivalent built-in, and Monaco's opaque blob also carries fold state, which
 * this package has no folding to save — so the shape here is a small, explicit, versionable record.
 *
 * Scroll is stored as the **top visible line number**, not a pixel offset: pixels depend on font
 * size, wrapping and window width, and a pixel value restored under different metrics lands on
 * unrelated text. Selection is stored as document offsets and clamped on restore, since the file may
 * have been edited elsewhere since it was last open.
 *
 * Framework-free, like every other module here: a host supplies the per-file `key` (a path or URL)
 * and a `ViewStateStore`, and decides the mode from its own settings UI.
 */

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type PluginValue } from "@codemirror/view";

export interface GcodeViewState {
	/** Main selection's anchor/head as document offsets (equal for a plain cursor). */
	anchor: number;
	head: number;
	/** 1-based line at the top of the viewport. */
	topLine: number;
	scrollLeft: number;
}

/** Read the current view state. Pure read — never dispatches. */
export function captureViewState(view: EditorView): GcodeViewState {
	const { main } = view.state.selection;
	const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
	return {
		anchor: main.anchor,
		head: main.head,
		topLine: view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)).number,
		scrollLeft: view.scrollDOM.scrollLeft,
	};
}

/** Structural check for an untrusted, possibly hand-edited or older-version stored value. */
export function isGcodeViewState(value: unknown): value is GcodeViewState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return ["anchor", "head", "topLine", "scrollLeft"].every((k) => typeof v[k] === "number" && Number.isFinite(v[k] as number));
}

/** Apply a saved state, clamped to the current document (it may be shorter than when saved). */
export function restoreViewState(view: EditorView, state: GcodeViewState): void {
	const doc = view.state.doc;
	const clamp = (n: number) => Math.min(Math.max(0, Math.floor(n)), doc.length);
	const topLine = Math.min(Math.max(1, Math.floor(state.topLine)), doc.lines);
	view.dispatch({
		selection: EditorSelection.single(clamp(state.anchor), clamp(state.head)),
		effects: EditorView.scrollIntoView(doc.line(topLine).from, { y: "start", yMargin: 0 }),
	});
	view.scrollDOM.scrollLeft = Math.max(0, state.scrollLeft);
}

export interface ViewStateStore {
	get(key: string): GcodeViewState | null;
	set(key: string, state: GcodeViewState): void;
	delete(key: string): void;
}

export function createMemoryViewStateStore(): ViewStateStore {
	const map = new Map<string, GcodeViewState>();
	return {
		get: (key) => map.get(key) ?? null,
		set: (key, state) => void map.set(key, state),
		delete: (key) => void map.delete(key),
	};
}

export interface WebStorageViewStateOptions {
	/** Storage key the whole map lives under. */
	storageKey?: string;
	/** Most-recently-used files kept; older ones are evicted so storage cannot grow without bound
	 *  (Fluidd's per-file keys never expire). */
	maxEntries?: number;
}

/**
 * A store over any `Storage` (`localStorage`/`sessionStorage`), or `null` for "off". One JSON map
 * under a single key with LRU eviction. Every access is wrapped in try/catch: storage can throw or
 * be empty in a private window or with site data blocked, and a view-state feature must never break
 * opening a file. Unparseable or wrongly-shaped data is treated as empty rather than trusted.
 */
export function createWebStorageViewStateStore(storage: Storage | null | undefined, options: WebStorageViewStateOptions = {}): ViewStateStore {
	const storageKey = options.storageKey ?? "dwc-gcode-editor:viewState";
	const maxEntries = options.maxEntries ?? 200;

	// Insertion order of the object's own keys is the recency order (oldest first).
	function load(): Record<string, GcodeViewState> {
		if (!storage) return {};
		try {
			const raw = storage.getItem(storageKey);
			const parsed: unknown = raw === null ? null : JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
			const out: Record<string, GcodeViewState> = {};
			for (const [k, v] of Object.entries(parsed)) if (isGcodeViewState(v)) out[k] = v;
			return out;
		} catch {
			return {};
		}
	}

	function save(map: Record<string, GcodeViewState>): void {
		if (!storage) return;
		try {
			storage.setItem(storageKey, JSON.stringify(map));
		} catch {
			/* quota exceeded / blocked — drop silently, the state is a convenience */
		}
	}

	return {
		get: (key) => load()[key] ?? null,
		set(key, state) {
			const map = load();
			delete map[key]; // re-insert at the end = most recent
			map[key] = state;
			const keys = Object.keys(map);
			for (const old of keys.slice(0, Math.max(0, keys.length - maxEntries))) delete map[old];
			save(map);
		},
		delete(key) {
			const map = load();
			if (!(key in map)) return;
			delete map[key];
			save(map);
		},
	};
}

/** Fluidd's setting values, mapped to a store — the one-liner a host's settings UI calls. Storage
 *  access itself can throw (blocked cookies), hence the try/catch around the property read. */
export function viewStateStoreForMode(mode: "local" | "session" | "off"): ViewStateStore {
	let storage: Storage | null = null;
	try {
		if (mode === "local") storage = globalThis.localStorage ?? null;
		else if (mode === "session") storage = globalThis.sessionStorage ?? null;
	} catch {
		storage = null;
	}
	return createWebStorageViewStateStore(storage);
}

export interface ViewStatePersistenceOptions {
	/** Identifies the file — a path or URL. Same key => same remembered position. */
	key: string;
	store: ViewStateStore;
	/** Quiet period before a change is written. The final state is always written on destroy
	 *  regardless. Default 500 ms. */
	saveDelayMs?: number;
}

/**
 * Restore this file's saved position when the editor is created, then keep it saved: debounced on
 * every selection or scroll change, and once more when the view is destroyed (Fluidd's own save
 * point). Nothing is written before the restore has run, so a brand-new view sitting at the top
 * cannot overwrite the position it was about to restore. With no saved state the editor is left
 * untouched.
 */
export function gcodeViewStatePersistence(options: ViewStatePersistenceOptions): Extension {
	const delay = options.saveDelayMs ?? 500;

	return ViewPlugin.fromClass(class implements PluginValue {
		private timer: ReturnType<typeof setTimeout> | null = null;
		private ready = false;
		private destroyed = false;
		private readonly onScroll = () => this.schedule();

		constructor(private readonly view: EditorView) {
			// A plugin may not dispatch from its constructor; the view is complete one microtask later.
			queueMicrotask(() => {
				if (this.destroyed) return;
				const saved = options.store.get(options.key);
				if (saved !== null) restoreViewState(view, saved);
				this.ready = true;
			});
			view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
		}

		update(update: { selectionSet: boolean }): void {
			if (update.selectionSet) this.schedule();
		}

		private schedule(): void {
			if (!this.ready) return;
			if (this.timer !== null) clearTimeout(this.timer);
			this.timer = setTimeout(() => this.write(), delay);
		}

		private write(): void {
			this.timer = null;
			options.store.set(options.key, captureViewState(this.view));
		}

		destroy(): void {
			this.destroyed = true;
			this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
			if (this.timer !== null) clearTimeout(this.timer);
			if (this.ready) this.write();
		}
	});
}
