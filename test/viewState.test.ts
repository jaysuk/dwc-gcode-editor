import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	captureViewState,
	createMemoryViewStateStore,
	createWebStorageViewStateStore,
	gcodeViewStatePersistence,
	isGcodeViewState,
	restoreViewState,
	viewStateStoreForMode,
	type GcodeViewState,
} from "../src/viewState";

const doc = Array.from({ length: 100 }, (_, i) => `G1 X${i}`).join("\n");
const state = (over: Partial<GcodeViewState> = {}): GcodeViewState => ({ anchor: 0, head: 0, topLine: 1, scrollLeft: 0, ...over });

function mount(extensions: Array<Extension> = [], text = doc) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({ state: EditorState.create({ doc: text, extensions }), parent });
	return { view, parent };
}

function fakeStorage(seed: Record<string, string> = {}): Storage {
	const data = { ...seed };
	return {
		get length() { return Object.keys(data).length; },
		clear: () => { for (const k of Object.keys(data)) delete data[k]; },
		getItem: (k: string) => (k in data ? data[k] : null),
		key: (i: number) => Object.keys(data)[i] ?? null,
		removeItem: (k: string) => { delete data[k]; },
		setItem: (k: string, v: string) => { data[k] = v; },
	};
}

const STORAGE_KEY = "dwc-gcode-editor:viewState";

afterEach(() => {
	document.body.innerHTML = "";
	vi.useRealTimers();
});

describe("captureViewState / restoreViewState", () => {
	it("captures the main selection", () => {
		const { view } = mount();
		view.dispatch({ selection: EditorSelection.single(12, 20) });
		expect(captureViewState(view)).toMatchObject({ anchor: 12, head: 20, topLine: 1 });
		view.destroy();
	});

	it("restores the selection, including its direction", () => {
		const { view } = mount();
		restoreViewState(view, state({ anchor: 30, head: 10 }));
		expect(view.state.selection.main.anchor).toBe(30);
		expect(view.state.selection.main.head).toBe(10);
		view.destroy();
	});

	it("captures the top visible line, not a pixel offset", () => {
		const { view } = mount();
		const line40 = view.state.doc.line(40);
		vi.spyOn(view, "lineBlockAtHeight").mockReturnValue({ from: line40.from + 3 } as ReturnType<EditorView["lineBlockAtHeight"]>);
		expect(captureViewState(view).topLine).toBe(40);
		view.destroy();
	});

	it("restores scroll by asking CM6 to put the saved line at the top of the viewport", () => {
		const { view } = mount();
		const spy = vi.spyOn(EditorView, "scrollIntoView");
		restoreViewState(view, state({ topLine: 40, scrollLeft: 17 }));
		expect(spy).toHaveBeenCalledWith(view.state.doc.line(40).from, { y: "start", yMargin: 0 });
		expect(view.scrollDOM.scrollLeft).toBe(17);
		view.destroy();
	});

	it("clamps offsets and line numbers to a document that is now shorter", () => {
		const { view } = mount([], "G28\nG1 X1");
		expect(() => restoreViewState(view, state({ anchor: 9999, head: 9999, topLine: 500 }))).not.toThrow();
		expect(view.state.selection.main.head).toBe(view.state.doc.length);
		restoreViewState(view, state({ anchor: -5, head: -5, topLine: -3 }));
		expect(view.state.selection.main.head).toBe(0);
		view.destroy();
	});
});

describe("isGcodeViewState", () => {
	it("accepts a complete record and rejects partial, non-numeric, NaN and non-object values", () => {
		expect(isGcodeViewState(state())).toBe(true);
		expect(isGcodeViewState({ anchor: 1, head: 1, topLine: 1 })).toBe(false);
		expect(isGcodeViewState({ ...state(), head: "1" })).toBe(false);
		expect(isGcodeViewState({ ...state(), topLine: NaN })).toBe(false);
		expect(isGcodeViewState(null)).toBe(false);
		expect(isGcodeViewState("x")).toBe(false);
	});
});

describe("createWebStorageViewStateStore", () => {
	it("round-trips per key and deletes", () => {
		const s = createWebStorageViewStateStore(fakeStorage());
		s.set("a", state({ head: 3 }));
		s.set("b", state({ head: 4 }));
		expect(s.get("a")?.head).toBe(3);
		expect(s.get("b")?.head).toBe(4);
		s.delete("a");
		expect(s.get("a")).toBeNull();
		expect(s.get("b")?.head).toBe(4);
	});

	it("evicts the least recently used file past maxEntries", () => {
		const s = createWebStorageViewStateStore(fakeStorage(), { maxEntries: 2 });
		s.set("a", state());
		s.set("b", state());
		s.set("a", state({ head: 1 })); // touch a, so b is now the oldest
		s.set("c", state());
		expect(s.get("b")).toBeNull();
		expect(s.get("a")).not.toBeNull();
		expect(s.get("c")).not.toBeNull();
	});

	it("treats corrupt JSON and wrongly-shaped entries as empty instead of throwing", () => {
		expect(createWebStorageViewStateStore(fakeStorage({ [STORAGE_KEY]: "{not json" })).get("a")).toBeNull();
		expect(createWebStorageViewStateStore(fakeStorage({ [STORAGE_KEY]: JSON.stringify({ a: { anchor: "x" } }) })).get("a")).toBeNull();
		expect(createWebStorageViewStateStore(fakeStorage({ [STORAGE_KEY]: "[1,2]" })).get("a")).toBeNull();
	});

	it("never throws when storage itself throws, or when there is no storage (mode off)", () => {
		const throwing = {
			...fakeStorage(),
			getItem: () => { throw new Error("blocked"); },
			setItem: () => { throw new Error("quota"); },
		} as Storage;
		const s = createWebStorageViewStateStore(throwing);
		expect(() => s.set("a", state())).not.toThrow();
		expect(s.get("a")).toBeNull();
		const off = createWebStorageViewStateStore(null);
		off.set("a", state());
		expect(off.get("a")).toBeNull();
	});
});

describe("viewStateStoreForMode", () => {
	it("local and session use their own storage; off stores nothing", () => {
		const local = fakeStorage();
		const session = fakeStorage();
		vi.stubGlobal("localStorage", local);
		vi.stubGlobal("sessionStorage", session);
		viewStateStoreForMode("local").set("f", state({ head: 7 }));
		expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
		expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
		viewStateStoreForMode("session").set("f", state({ head: 8 }));
		expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
		const off = viewStateStoreForMode("off");
		off.set("zzz", state());
		expect(off.get("zzz")).toBeNull();
		vi.unstubAllGlobals();
	});
});

describe("gcodeViewStatePersistence", () => {
	it("restores a saved position when the editor is created", async () => {
		const store = createMemoryViewStateStore();
		store.set("file", state({ anchor: 25, head: 25 }));
		const { view } = mount([gcodeViewStatePersistence({ key: "file", store })]);
		await Promise.resolve();
		expect(view.state.selection.main.head).toBe(25);
		view.destroy();
	});

	it("leaves the editor untouched when nothing is saved", async () => {
		const store = createMemoryViewStateStore();
		const { view } = mount([gcodeViewStatePersistence({ key: "file", store })]);
		await Promise.resolve();
		expect(view.state.selection.main.head).toBe(0);
		view.destroy();
	});

	it("saves debounced after a selection change, coalescing rapid changes", async () => {
		vi.useFakeTimers();
		const store = createMemoryViewStateStore();
		const set = vi.spyOn(store, "set");
		const { view } = mount([gcodeViewStatePersistence({ key: "file", store, saveDelayMs: 100 })]);
		await Promise.resolve();
		view.dispatch({ selection: { anchor: 5 } });
		view.dispatch({ selection: { anchor: 9 } });
		expect(set).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(set).toHaveBeenCalledTimes(1);
		expect(store.get("file")?.head).toBe(9);
		view.destroy();
	});

	it("writes the final state on destroy even inside the debounce window", async () => {
		const store = createMemoryViewStateStore();
		const { view } = mount([gcodeViewStatePersistence({ key: "file", store, saveDelayMs: 60_000 })]);
		await Promise.resolve();
		view.dispatch({ selection: { anchor: 42 } });
		view.destroy();
		expect(store.get("file")?.head).toBe(42);
	});

	it("does not overwrite a saved position before the restore has run", () => {
		const store = createMemoryViewStateStore();
		store.set("file", state({ anchor: 50, head: 50 }));
		const { view } = mount([gcodeViewStatePersistence({ key: "file", store })]);
		view.destroy(); // destroyed before the restore microtask
		expect(store.get("file")?.head).toBe(50);
	});

	it("keeps files independent by key", async () => {
		const store = createMemoryViewStateStore();
		const a = mount([gcodeViewStatePersistence({ key: "a", store })]);
		const b = mount([gcodeViewStatePersistence({ key: "b", store })]);
		await Promise.resolve();
		a.view.dispatch({ selection: { anchor: 3 } });
		b.view.dispatch({ selection: { anchor: 60 } });
		a.view.destroy();
		b.view.destroy();
		expect(store.get("a")?.head).toBe(3);
		expect(store.get("b")?.head).toBe(60);
	});
});
