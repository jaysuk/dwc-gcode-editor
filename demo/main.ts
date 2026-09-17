/**
 * A small, plain-TS (no framework — this package is framework-free, so its own demo stays that
 * way too) interactive harness wiring every module together: workspace tabs/split panes, a real
 * CM6 editor per tab with G-code highlighting and diagnostics, and a manual "Check for errors"
 * button. Not part of the published package — `npm run dev` only.
 */

import { lintGutter } from "@codemirror/lint";
import { lineNumbers, EditorView } from "@codemirror/view";
import { diagnoseDocument, parseDocument } from "dwc-gcode-core";

import { gcodeCompletion } from "../src/completion";
import { buildDocFromChunks, buildDocFromString } from "../src/docBuilder";
import { applyDiagnostics, gcodeLintUi } from "../src/diagnostics";
import { createEditorInstance, type EditorInstance } from "../src/editorCore";
import { gcodeLanguage } from "../src/language";
import { createThemeController, type ThemeController } from "../src/theme";
import {
	activeTab, canSplit, closeSplit, closeTab, createWorkspace, moveTab, openTab,
	setActiveTab, setDirty, splitRight, tabsInGroup, type WorkspaceState,
} from "../src/workspace";

interface TabData {
	name: string;
	/** Seeded once at open time; the editor instance is the source of truth after that. */
	initialDoc: string | Awaited<ReturnType<typeof buildDocFromString>>;
}

const panesEl = document.getElementById("panes")!;
const statsEl = document.getElementById("stats")!;
const logEl = document.getElementById("log")!;
const fwInput = document.getElementById("fw-version") as HTMLInputElement;

function log(message: string): void {
	const line = document.createElement("div");
	line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
	logEl.prepend(line);
}

let workspace: WorkspaceState<TabData> = createWorkspace<TabData>({ name: "welcome", initialDoc: SAMPLE_TEXT() });
const instances = new Map<number, EditorInstance>();
const themeControllers = new Map<number, ThemeController>();
const darkChk = document.getElementById("chk-dark") as HTMLInputElement;

function SAMPLE_TEXT(): string {
	return [
		"; dwc-gcode-editor demo - open a real file, or edit this one",
		"if move.axes[0].homed",
		"  var liftHeight = 5",
		"  G90 G1 Z{var.liftHeight}",
		"else",
		'  M291 P"Home the machine first" S0',
		"G1 X10 Y10 F1800",
		"M106 Q1 ; real error: M106 has no Q parameter - try Check for errors",
		"T0 G1 X10 ; real error: a T command must be on a line by itself",
	].join("\n");
}

function editorExtensions(tabId: number, theme: ThemeController) {
	return [
		lineNumbers(),
		gcodeLanguage,
		theme.extension,
		gcodeCompletion(),
		gcodeLintUi(),
		lintGutter(),
		// Live dirty tracking is a demo/host UI concern, not editorCore.ts's own job - that module
		// only guarantees onFlush fires before destroy, it says nothing about when a host chooses
		// to mark a tab dirty in its own UI. Wired here via CM6's own update listener rather than
		// waiting for a flush, so the tab strip's "*" shows immediately as the user types.
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				workspace = setDirty(workspace, tabId, true);
				renderTabStrips();
			}
		}),
	];
}

function instanceFor(tabId: number, slot: HTMLElement): EditorInstance {
	let instance = instances.get(tabId);
	if (instance !== undefined) {
		// render() rebuilds the whole pane DOM from scratch on every call (splitting, closing a
		// tab, moving one between panes, …), so an already-live editor's DOM node needs to be
		// re-parented into its new slot - otherwise it stays attached to the now-discarded old
		// container and the new slot renders empty. This is exactly what showed up as "split
		// screen results in 2 non-rendered files": splitRight() moves a tab into a second group,
		// render() rebuilds both panes' DOM, and neither editor's dom was ever moved into place.
		slot.appendChild(instance.view.dom);
		return instance;
	}

	const tab = workspace.tabs.find((t) => t.id === tabId)!;
	const theme = createThemeController(darkChk.checked);
	themeControllers.set(tabId, theme);
	instance = createEditorInstance({
		doc: tab.data.initialDoc,
		parent: slot,
		extensions: editorExtensions(tabId, theme),
		onFlush: () => {
			// Clears the dirty flag once the content has actually been reported back - see
			// editorCore.ts's own doc comment for why destroy() always calls this, not just an
			// explicit save action.
			workspace = setDirty(workspace, tabId, false);
			renderTabStrips();
		},
	});
	instances.set(tabId, instance);
	return instance;
}

function destroyInstance(tabId: number): void {
	instances.get(tabId)?.destroy();
	instances.delete(tabId);
	themeControllers.delete(tabId);
}

function render(): void {
	panesEl.innerHTML = "";
	for (const group of workspace.groups) {
		const paneEl = document.createElement("div");
		paneEl.className = "pane";
		paneEl.dataset.groupId = String(group.id);

		const stripEl = document.createElement("div");
		stripEl.className = "tabstrip";
		paneEl.appendChild(stripEl);

		const slotEl = document.createElement("div");
		slotEl.className = "editor-slot";
		paneEl.appendChild(slotEl);

		for (const tab of tabsInGroup(workspace, group.id)) {
			const editorHost = document.createElement("div");
			editorHost.hidden = tab.id !== group.activeTabId;
			slotEl.appendChild(editorHost);
			instanceFor(tab.id, editorHost);
		}

		panesEl.appendChild(paneEl);
	}
	renderTabStrips();
	updateStats();
}

function renderTabStrips(): void {
	for (const group of workspace.groups) {
		const paneEl = panesEl.querySelector(`.pane[data-group-id="${group.id}"]`);
		const stripEl = paneEl?.querySelector<HTMLElement>(".tabstrip");
		if (!stripEl) continue;
		stripEl.innerHTML = "";
		for (const tab of tabsInGroup(workspace, group.id)) {
			const tabEl = document.createElement("div");
			tabEl.className = "tab" + (tab.id === group.activeTabId ? " active" : "") + (tab.dirty ? " dirty" : "");
			tabEl.draggable = true;
			tabEl.textContent = tab.data.name;
			tabEl.title = `Tab #${tab.id}`;

			const closeEl = document.createElement("span");
			closeEl.className = "close";
			closeEl.textContent = "✕";
			closeEl.onclick = (e) => { e.stopPropagation(); onCloseTab(tab.id); };
			tabEl.appendChild(closeEl);

			tabEl.onclick = () => { workspace = setActiveTab(workspace, tab.id); showActiveEditors(); };
			tabEl.ondragstart = (e) => e.dataTransfer?.setData("text/plain", String(tab.id));

			stripEl.appendChild(tabEl);
		}
		stripEl.ondragover = (e) => e.preventDefault();
		stripEl.ondrop = (e) => {
			e.preventDefault();
			const draggedId = Number(e.dataTransfer?.getData("text/plain"));
			if (Number.isFinite(draggedId)) {
				workspace = moveTab(workspace, draggedId, group.id);
				render();
			}
		};
	}
}

/** Cheaper than a full `render()` for a plain tab switch: no editors are created/destroyed, just
 *  which one is visible. */
function showActiveEditors(): void {
	for (const group of workspace.groups) {
		const paneEl = panesEl.querySelector(`.pane[data-group-id="${group.id}"]`);
		paneEl?.querySelectorAll<HTMLElement>(".editor-slot > div").forEach((el, i) => {
			const tab = tabsInGroup(workspace, group.id)[i];
			el.hidden = tab?.id !== group.activeTabId;
		});
	}
	renderTabStrips();
}

function onCloseTab(tabId: number): void {
	destroyInstance(tabId);
	workspace = closeTab(workspace, tabId);
	if (workspace.tabs.length === 0) workspace = openTab(workspace, { name: "untitled", initialDoc: "" });
	render();
}

function updateStats(): void {
	const tab = activeTab(workspace, workspace.focusedGroupId);
	if (tab === null) { statsEl.textContent = ""; return; }
	const instance = instances.get(tab.id);
	const doc = instance?.view.state.doc;
	statsEl.textContent = doc ? `${doc.lines.toLocaleString()} lines, ${doc.length.toLocaleString()} chars` : "";
}

async function* streamFileAsTextChunks(file: File): AsyncGenerator<string> {
	const reader = file.stream().getReader();
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		yield decoder.decode(value, { stream: true });
	}
	yield decoder.decode();
}

async function openFile(file: File): Promise<void> {
	log(`Opening ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
	const t0 = performance.now();
	const doc = await buildDocFromChunks(streamFileAsTextChunks(file));
	const ms = (performance.now() - t0).toFixed(0);
	log(`Built ${doc.lines.toLocaleString()} lines in ${ms} ms`);
	workspace = openTab(workspace, { name: file.name, initialDoc: doc });
	render();
}

async function checkForErrors(): Promise<void> {
	const tab = activeTab(workspace, workspace.focusedGroupId);
	if (tab === null) return;
	const instance = instances.get(tab.id);
	if (instance === undefined) return;

	const t0 = performance.now();
	// A whole-document string round-trip - the documented, accepted cost of a MANUAL check
	// (diagnostics.ts's own module comment explains why this is never done automatically).
	const text = instance.view.state.doc.toString();
	const parsed = parseDocument(text);
	const firmwareVersion = fwInput.value.trim() || "3.7.0";
	const diagnostics = diagnoseDocument(parsed, tab.data.name, { firmwareVersion });
	applyDiagnostics(instance.view, diagnostics);
	const ms = (performance.now() - t0).toFixed(0);
	log(`Checked "${tab.data.name}": ${diagnostics.length} diagnostic(s) in ${ms} ms`);
}

document.getElementById("btn-open")!.addEventListener("click", () => {
	(document.getElementById("file-input") as HTMLInputElement).click();
});
document.getElementById("file-input")!.addEventListener("change", (e) => {
	const file = (e.target as HTMLInputElement).files?.[0];
	if (file) void openFile(file);
	(e.target as HTMLInputElement).value = "";
});
document.getElementById("btn-new-tab")!.addEventListener("click", () => {
	workspace = openTab(workspace, { name: "untitled", initialDoc: "" });
	render();
});
document.getElementById("btn-split")!.addEventListener("click", () => {
	if (!canSplit(workspace)) { log("Need at least 2 tabs in one pane to split."); return; }
	workspace = splitRight(workspace);
	render();
});
document.getElementById("btn-close-split")!.addEventListener("click", () => {
	workspace = closeSplit(workspace);
	render();
});
document.getElementById("btn-check")!.addEventListener("click", () => void checkForErrors());
darkChk.addEventListener("change", () => {
	for (const [tabId, instance] of instances) {
		themeControllers.get(tabId)?.setDark(instance.view, darkChk.checked);
	}
});

render();
log("Ready. Open a real .g/.gcode file, or edit the sample tab and click Check for errors.");
