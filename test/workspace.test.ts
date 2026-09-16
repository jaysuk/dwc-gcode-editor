import { describe, expect, it } from "vitest";
import {
	activeTab, canSplit, closeSplit, closeTab, createWorkspace, moveTab, openTab,
	PRIMARY_GROUP, SECONDARY_GROUP, setActiveTab, setDirty, setSplitRatio, splitRight, tabsInGroup,
} from "../src/workspace";

describe("createWorkspace", () => {
	it("starts with one tab, one group, that tab active and focused", () => {
		const w = createWorkspace("a");
		expect(w.tabs).toHaveLength(1);
		expect(w.groups).toHaveLength(1);
		expect(w.groups[0].id).toBe(PRIMARY_GROUP);
		expect(w.focusedGroupId).toBe(PRIMARY_GROUP);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("a");
	});
});

describe("openTab", () => {
	it("adds a tab to the focused group and makes it active", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		expect(tabsInGroup(w, PRIMARY_GROUP).map((t) => t.data)).toEqual(["a", "b"]);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("b");
	});

	it("assigns each new tab a distinct id, never reusing a closed one", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		const bId = activeTab(w, PRIMARY_GROUP)!.id;
		w = closeTab(w, bId);
		w = openTab(w, "c");
		const cId = activeTab(w, PRIMARY_GROUP)!.id;
		expect(cId).not.toBe(bId);
	});

	it("opens into a specific group when asked, without disturbing focus semantics of the other", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = splitRight(w); // b moves to SECONDARY, a stays PRIMARY
		w = openTab(w, "c", PRIMARY_GROUP);
		expect(tabsInGroup(w, PRIMARY_GROUP).map((t) => t.data)).toEqual(["a", "c"]);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("c");
		expect(w.focusedGroupId).toBe(PRIMARY_GROUP);
	});
});

describe("closeTab", () => {
	it("does nothing for an unknown id", () => {
		const w = createWorkspace("a");
		expect(closeTab(w, 999)).toEqual(w);
	});

	it("activates the next sibling when the active tab closes", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = openTab(w, "c");
		const bId = w.tabs.find((t) => t.data === "b")!.id;
		w = setActiveTab(w, bId);
		w = closeTab(w, bId);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("c");
	});

	it("falls back to the previous sibling when the closed tab was last", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = openTab(w, "c"); // c is active
		const cId = activeTab(w, PRIMARY_GROUP)!.id;
		w = closeTab(w, cId);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("b");
	});

	it("closing a non-active tab leaves the active tab untouched", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b"); // b active
		const aId = w.tabs.find((t) => t.data === "a")!.id;
		w = closeTab(w, aId);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("b");
		expect(w.tabs.map((t) => t.data)).toEqual(["b"]);
	});

	it("allows a group to reach zero tabs rather than refusing or inventing a placeholder", () => {
		let w = createWorkspace("a");
		w = closeTab(w, w.tabs[0].id);
		expect(w.tabs).toHaveLength(0);
		expect(activeTab(w, PRIMARY_GROUP)).toBeNull();
	});
});

describe("setActiveTab / setDirty", () => {
	it("setActiveTab focuses that tab's group", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = splitRight(w); // b -> SECONDARY, focused = SECONDARY
		const aId = w.tabs.find((t) => t.data === "a")!.id;
		w = setActiveTab(w, aId);
		expect(w.focusedGroupId).toBe(PRIMARY_GROUP);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("a");
	});

	it("setActiveTab on an unknown id is a no-op", () => {
		const w = createWorkspace("a");
		expect(setActiveTab(w, 999)).toEqual(w);
	});

	it("setDirty flips only the named tab", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		const aId = w.tabs.find((t) => t.data === "a")!.id;
		w = setDirty(w, aId, true);
		expect(w.tabs.find((t) => t.data === "a")?.dirty).toBe(true);
		expect(w.tabs.find((t) => t.data === "b")?.dirty).toBe(false);
	});
});

describe("canSplit / splitRight / closeSplit", () => {
	it("cannot split with only one tab", () => {
		const w = createWorkspace("a");
		expect(canSplit(w)).toBe(false);
		expect(splitRight(w)).toEqual(w);
	});

	it("cannot split when already split", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = splitRight(w);
		expect(canSplit(w)).toBe(false);
	});

	it("splitRight moves the active tab into a new second group and focuses it", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b"); // b active
		w = splitRight(w);
		expect(w.groups).toHaveLength(2);
		expect(tabsInGroup(w, PRIMARY_GROUP).map((t) => t.data)).toEqual(["a"]);
		expect(tabsInGroup(w, SECONDARY_GROUP).map((t) => t.data)).toEqual(["b"]);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("a");
		expect(activeTab(w, SECONDARY_GROUP)?.data).toBe("b");
		expect(w.focusedGroupId).toBe(SECONDARY_GROUP);
	});

	it("splitting with 3 tabs leaves a sensible active tab behind in the primary pane", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = openTab(w, "c"); // c active
		w = splitRight(w);
		// c moved to secondary; primary's active tab must be one of its remaining siblings
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("b");
		expect(tabsInGroup(w, PRIMARY_GROUP).map((t) => t.data)).toEqual(["a", "b"]);
	});

	it("closeSplit merges the secondary pane's tabs back and removes it", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = splitRight(w);
		w = closeSplit(w);
		expect(w.groups).toHaveLength(1);
		expect(w.tabs.map((t) => t.data)).toEqual(["a", "b"]);
		expect(activeTab(w, PRIMARY_GROUP)?.data).toBe("b");
		expect(w.focusedGroupId).toBe(PRIMARY_GROUP);
	});

	it("closeSplit on an unsplit workspace is a no-op", () => {
		const w = createWorkspace("a");
		expect(closeSplit(w)).toEqual(w);
	});
});

describe("moveTab", () => {
	it("moves a tab to the other group and makes it active there", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = splitRight(w); // a: PRIMARY, b: SECONDARY
		const aId = w.tabs.find((t) => t.data === "a")!.id;
		w = moveTab(w, aId, SECONDARY_GROUP);
		expect(tabsInGroup(w, PRIMARY_GROUP)).toHaveLength(0);
		expect(tabsInGroup(w, SECONDARY_GROUP).map((t) => t.data)).toEqual(["b", "a"]);
		expect(activeTab(w, SECONDARY_GROUP)?.data).toBe("a");
	});

	it("picks a new active tab in the group a tab was moved out of, when it was the active one", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = splitRight(w); // a: PRIMARY (active), b: SECONDARY (active)
		const bId = w.tabs.find((t) => t.data === "b")!.id;
		w = moveTab(w, bId, PRIMARY_GROUP);
		// SECONDARY is now empty
		expect(tabsInGroup(w, SECONDARY_GROUP)).toHaveLength(0);
		expect(activeTab(w, SECONDARY_GROUP)).toBeNull();
	});

	it("reorders within the same group when a beforeTabId is given", () => {
		let w = createWorkspace("a");
		w = openTab(w, "b");
		w = openTab(w, "c");
		const aId = w.tabs.find((t) => t.data === "a")!.id;
		const cId = w.tabs.find((t) => t.data === "c")!.id;
		w = moveTab(w, cId, PRIMARY_GROUP, aId);
		expect(w.tabs.map((t) => t.data)).toEqual(["c", "a", "b"]);
	});

	it("does nothing for an unknown tab id", () => {
		const w = createWorkspace("a");
		expect(moveTab(w, 999, SECONDARY_GROUP)).toEqual(w);
	});
});

describe("setSplitRatio", () => {
	it("clamps to a sane range so neither pane can be dragged to nothing", () => {
		const w = createWorkspace("a");
		expect(setSplitRatio(w, 0).splitRatio).toBeGreaterThan(0);
		expect(setSplitRatio(w, 1).splitRatio).toBeLessThan(1);
		expect(setSplitRatio(w, 0.5).splitRatio).toBe(0.5);
	});
});

describe("purity", () => {
	it("never mutates the state object passed in", () => {
		const w = createWorkspace("a");
		const frozen = JSON.parse(JSON.stringify(w));
		openTab(w, "b");
		closeTab(w, w.tabs[0].id);
		splitRight(openTab(w, "b"));
		expect(JSON.parse(JSON.stringify(w))).toEqual(frozen);
	});
});
