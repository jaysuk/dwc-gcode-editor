/**
 * A "you are here" line highlight, the shared CM6 primitive behind a debugger-style stepper — any
 * host wanting to show "this is the line the derived/live state corresponds to right now" (a file
 * scrub bar, a step-through UI, eventually a live single-step feature) needs the same two things:
 * highlight one line, and scroll it into view without disturbing the user's own selection. Framework-
 * agnostic and reusable, unlike a per-host `Decoration` a stepper UI would otherwise have to hand-roll.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

const setCurrentLineEffect = StateEffect.define<number | null>();

const currentLineMark = Decoration.line({ class: "cm-gcodeCurrentLine" });

const currentLineField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		for (const effect of tr.effects) {
			if (!effect.is(setCurrentLineEffect)) continue;
			if (effect.value === null) return Decoration.none;
			// Clamped rather than rejected: a host's own line-number source (e.g. a scrub bar bound to
			// a stale document length) can legitimately be out of range for a split second around an
			// edit or reload.
			const lineNo = Math.min(Math.max(1, effect.value), tr.state.doc.lines);
			const line = tr.state.doc.line(lineNo);
			return Decoration.set([currentLineMark.range(line.from)]);
		}
		// No relevant effect this transaction - keep the highlight on the same line through an
		// unrelated document edit elsewhere, the same way a search match or a breakpoint would.
		return deco.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

const currentLineTheme = EditorView.baseTheme({
	".cm-gcodeCurrentLine": { backgroundColor: "rgba(64, 144, 255, 0.18)" },
});

/** Include once among an editor's extensions to enable `setCurrentLine` - the highlight is invisible
 *  (nothing decorated) until the first `setCurrentLine` call. */
export function gcodeCurrentLine(): Extension {
	return [currentLineField, currentLineTheme];
}

/**
 * Highlights `line` (1-based) and, by default, scrolls it into view (centered) - pass
 * `scroll: false` to move the highlight without disturbing the current scroll position (e.g. while
 * the user is manually scrolling and a step just wants to mark where they'd land). `line: null`
 * clears the highlight entirely. A no-op if `gcodeCurrentLine()` isn't part of the view's extensions.
 */
export function setCurrentLine(view: EditorView, line: number | null, options: { scroll?: boolean } = {}): void {
	const effects: Array<StateEffect<unknown>> = [setCurrentLineEffect.of(line)];
	if (line !== null && options.scroll !== false) {
		const clamped = Math.min(Math.max(1, line), view.state.doc.lines);
		const pos = view.state.doc.line(clamped).from;
		effects.push(EditorView.scrollIntoView(pos, { y: "center" }));
	}
	view.dispatch({ effects });
}
