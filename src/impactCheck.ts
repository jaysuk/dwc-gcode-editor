/**
 * "Changed since <version>" squiggles: marks the lines of a file that use something whose behaviour changed between two
 * RepRapFirmware versions - a command that was removed, a parameter whose default moved, an object-model path that is
 * new - using `dwc-gcode-core`'s release catalogue (`impactOf` / `impactToDiagnostics`).
 *
 * The host decides the range (`getRange`): typically the version the machine ran when the user last reviewed a firmware
 * change, up to the version it runs now, or the version a firmware-update widget is about to install. `null` switches the
 * extension off, and so does a path that is not G-code (a menu file, `board.txt`, a print file).
 *
 * Why this is separate from `liveCheck.ts`: `impactOf` is document-wide, and a single line cannot see an `M453` mode
 * switch above it, so it never joins the single-line pass. It runs once shortly after load and again `delayMs` after the
 * last edit (up to `maxChars`), like the live check's whole-file pass.
 *
 * Coexisting with the other linters: `@codemirror/lint` keeps ONE set of diagnostics per editor, and `setDiagnostics`
 * replaces all of it. This extension therefore writes `existing - its own + fresh`, and tells its own apart by
 * `source === IMPACT_SOURCE`; `applyDiagnostics` (the "Check for errors" button, the on-load check) keeps them in turn.
 * A host that dispatches `setDiagnostics` itself has to do the same.
 *
 * Needs `gcodeLintUi()` (or any `@codemirror/lint` setup) in the same editor.
 */

import { forEachDiagnostic, setDiagnostics, type Action, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { StateEffect, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { impactEventId, impactOf, impactToDiagnostics, isScannable, parseDocument, type Diagnostic as CoreDiagnostic, type DiagnoseOptions } from "dwc-gcode-core";

/** The `source` of every diagnostic this extension produces; a host can style or filter on it. */
export const IMPACT_SOURCE = "rrf-changes";

/** A CM diagnostic that came from this module, with the core rule and the change it is about. */
export interface ImpactDiagnostic extends CmDiagnostic {
	source: typeof IMPACT_SOURCE;
	/** `release/removed`, `release/changed`, ... - the core rule id. */
	rule: string;
	/** The change event's stable id (what `isAcknowledged`/`onIgnore` are given). */
	eventId: string;
}

export function isImpactDiagnostic(d: CmDiagnostic): d is ImpactDiagnostic {
	return d.source === IMPACT_SOURCE;
}

export interface ImpactRange {
	/** The firmware version the file was last reviewed against / is coming from. */
	from: string;
	/** The firmware version it is moving to / running on. */
	to: string;
}

export interface ImpactCheckOptions {
	/** Read at each check (a thunk: the machine model may arrive later). `null` = off. */
	getRange: () => ImpactRange | null;
	/** The file's path, read at each check. A non-G-code path turns the check off. */
	path: () => string;
	/** True for a change the user has chosen to stop hearing about. Read at each check. */
	isAcknowledged?: (eventId: string) => boolean;
	/** The hover action "Ignore this change" calls this. Omit it and there is no such action. */
	onIgnore?: (eventId: string) => void;
	/** Label of that action. Default "Ignore this change". */
	ignoreLabel?: string;
	/** Text before the version in the hover ("Changed in 3.7.0-beta.1"). Default "Changed in". */
	changedInLabel?: string;
	/** Called after every pass with how many findings the editor now holds (0 when off). */
	onFinding?: (count: number) => void;
	/** Severity overrides / disabled rules, as `diagnoseDocument`'s `rules`. */
	rules?: DiagnoseOptions["rules"];
	/** Delay before the first pass after the editor is created. Default 50. */
	initialDelayMs?: number;
	/** Delay after the last edit before the file is re-checked. Default 1500. */
	delayMs?: number;
	/** Documents over this many characters are not checked. Default 500,000, as the live check's whole-file pass. */
	maxChars?: number;
}

const refreshEffect = StateEffect.define<null>();

/** Re-runs the check now (the range, the acknowledged set or the path changed at run time). A no-op without the extension. */
export function refreshImpactCheck(view: EditorView): void {
	view.dispatch({ effects: refreshEffect.of(null) });
}

function actionsFor(eventId: string, options: Pick<ImpactCheckOptions, "onIgnore" | "ignoreLabel">): Array<Action> | undefined {
	if (options.onIgnore === undefined) return undefined;
	const onIgnore = options.onIgnore;
	return [{
		name: options.ignoreLabel ?? "Ignore this change",
		apply: (view) => { onIgnore(eventId); refreshImpactCheck(view); },
	}];
}

function render(headline: string, changedIn: string, sources: ReadonlyArray<string>): Node {
	const box = document.createElement("div");
	box.className = "cm-rrf-change";
	const p = document.createElement("div");
	p.textContent = headline;
	const v = document.createElement("div");
	v.className = "cm-rrf-change-version";
	v.textContent = changedIn;
	box.append(p, v);
	if (sources.length > 0) {
		const s = document.createElement("div");
		s.className = "cm-rrf-change-source";
		s.textContent = sources.join("; ");
		box.append(s);
	}
	return box;
}

/**
 * The squiggles for `text` between two firmware versions, positioned in that text. Pure (no editor), so a host can test
 * it or use it for a file that is not open. Empty when the path is not G-code.
 */
export function impactDiagnostics(text: string, range: ImpactRange, path: string, options: Pick<ImpactCheckOptions, "isAcknowledged" | "onIgnore" | "ignoreLabel" | "changedInLabel" | "rules"> = {}): Array<ImpactDiagnostic> {
	if (!isScannable(path).scan) return [];
	const findings = impactOf(parseDocument(text), range.from, range.to)
		.filter((f) => options.isAcknowledged?.(f.event.id) !== true);
	const core: Array<CoreDiagnostic> = impactToDiagnostics(findings, { file: path, rules: options.rules });
	const out: Array<ImpactDiagnostic> = [];
	for (const d of core) {
		// `impactToDiagnostics` drops a disabled rule, so the finding is recovered by event id rather than by position.
		const eventId = impactEventId(d)!;
		const event = findings.find((f) => f.event.id === eventId)!.event;
		const message = d.message.slice(0, d.message.length - eventId.length - 3);
		const changedIn = `${options.changedInLabel ?? "Changed in"} ${event.version}`;
		const actions = actionsFor(eventId, options);
		const diagnostic: ImpactDiagnostic = {
			from: d.start, to: d.end, severity: d.severity, source: IMPACT_SOURCE, rule: d.rule, eventId,
			message: `${message} - ${changedIn}`,
			renderMessage: () => render(message, changedIn, d.sources),
		};
		if (actions !== undefined) diagnostic.actions = actions;
		out.push(diagnostic);
	}
	return out;
}

class ImpactCheck implements PluginValue {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private destroyed = false;
	private shown = 0;

	constructor(private readonly view: EditorView, private readonly o: ImpactCheckOptions) {
		this.schedule(o.initialDelayMs ?? 50);
	}

	update(u: ViewUpdate): void {
		if (u.docChanged) this.schedule(this.o.delayMs ?? 1500);
		else if (u.transactions.some((t) => t.effects.some((e) => e.is(refreshEffect)))) this.schedule(0);
	}

	destroy(): void {
		this.destroyed = true;
		clearTimeout(this.timer);
	}

	private schedule(ms: number): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => { if (!this.destroyed) this.run(); }, ms);
	}

	private run(): void {
		const { state } = this.view;
		const range = this.o.getRange();
		const path = this.o.path();
		const tooBig = state.doc.length > (this.o.maxChars ?? 500_000);
		const fresh = range === null || tooBig || range.from === range.to
			? []
			: impactDiagnostics(state.doc.toString(), range, path, this.o);

		const kept: Array<CmDiagnostic> = [];
		let hadOwn = 0;
		forEachDiagnostic(state, (d, from, to) => {
			if (isImpactDiagnostic(d)) hadOwn++;
			else kept.push({ ...d, from, to });
		});
		this.shown = fresh.length;
		if (hadOwn > 0 || fresh.length > 0) this.view.dispatch(setDiagnostics(state, [...kept, ...fresh]));
		this.o.onFinding?.(this.shown);
	}
}

/** See the module comment. Add alongside `gcodeLintUi()`. */
export function gcodeImpactCheck(options: ImpactCheckOptions): Extension {
	return ViewPlugin.define((view) => new ImpactCheck(view, options));
}
