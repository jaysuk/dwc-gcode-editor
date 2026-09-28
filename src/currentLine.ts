/**
 * A "you are here" line highlight, the shared CM6 primitive behind a debugger-style stepper — any
 * host wanting to show "this is the line the derived/live state corresponds to right now" (a file
 * scrub bar, a step-through UI, eventually a live single-step feature) needs the same two things:
 * highlight one line, and scroll it into view without disturbing the user's own selection. Framework-
 * agnostic and reusable, unlike a per-host `Decoration` a stepper UI would otherwise have to hand-roll.
 *
 * A stepper walking a macro also wants to show the line AS EVALUATED right under the source line
 * (`G1 X{var.a + 5}` above `G1 X105`), so `setCurrentLine` optionally takes a
 * {@link CurrentLineAnnotation}: a block widget drawn beneath the highlighted line, made of segments
 * so the substituted values can be told apart from the text that was already there. This package
 * doesn't compute the evaluation - `dwc-gcode-core`'s `renderEvaluatedLine` produces exactly this
 * segment shape, and any host can build its own.
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/** One run of text in the evaluated line. `"source"`: as written. `"value"`: an expression replaced by
 *  what it evaluated to. `"result"`: appended after the line (a condition's outcome, an assignment). */
export interface CurrentLineAnnotationSegment {
	text: string;
	kind: "source" | "value" | "result";
}

export interface CurrentLineAnnotation {
	segments: ReadonlyArray<CurrentLineAnnotationSegment>;
}

interface CurrentLineUpdate {
	line: number | null;
	annotation: CurrentLineAnnotation | null;
}

const setCurrentLineEffect = StateEffect.define<CurrentLineUpdate>();

const currentLineMark = Decoration.line({ class: "cm-gcodeCurrentLine" });

class EvaluatedLineWidget extends WidgetType {
	constructor(private readonly annotation: CurrentLineAnnotation) {
		super();
	}

	eq(other: EvaluatedLineWidget): boolean {
		const a = this.annotation.segments;
		const b = other.annotation.segments;
		return a.length === b.length && a.every((s, i) => s.kind === b[i]!.kind && s.text === b[i]!.text);
	}

	toDOM(): HTMLElement {
		const el = document.createElement("div");
		el.className = "cm-gcodeEvaluatedLine";
		el.setAttribute("aria-label", "Line as evaluated");
		for (const segment of this.annotation.segments) {
			const span = document.createElement("span");
			span.className = `cm-gcodeEvaluated-${segment.kind}`;
			span.textContent = segment.text;
			el.appendChild(span);
		}
		return el;
	}
}

const currentLineField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		for (const effect of tr.effects) {
			if (!effect.is(setCurrentLineEffect)) continue;
			const { line: requested, annotation } = effect.value;
			if (requested === null) return Decoration.none;
			// Clamped rather than rejected: a host's own line-number source (e.g. a scrub bar bound to
			// a stale document length) can legitimately be out of range for a split second around an
			// edit or reload.
			const lineNo = Math.min(Math.max(1, requested), tr.state.doc.lines);
			const line = tr.state.doc.line(lineNo);
			const ranges = [currentLineMark.range(line.from)];
			if (annotation !== null && annotation.segments.length > 0) {
				// side: 1 puts it after the line's own end; block: true makes it its own row beneath.
				ranges.push(Decoration.widget({ widget: new EvaluatedLineWidget(annotation), block: true, side: 1 }).range(line.to));
			}
			return Decoration.set(ranges);
		}
		// No relevant effect this transaction - keep the highlight on the same line through an
		// unrelated document edit elsewhere, the same way a search match or a breakpoint would.
		return deco.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

const currentLineTheme = EditorView.baseTheme({
	".cm-gcodeCurrentLine": { backgroundColor: "rgba(64, 144, 255, 0.18)" },
	".cm-gcodeEvaluatedLine": {
		whiteSpace: "pre",
		padding: "1px 0",
		backgroundColor: "rgba(64, 144, 255, 0.08)",
		borderLeft: "3px solid rgba(64, 144, 255, 0.7)",
	},
	"&light .cm-gcodeEvaluated-value": { color: "#0b5cad", fontWeight: "bold" },
	"&dark .cm-gcodeEvaluated-value": { color: "#7fb8ff", fontWeight: "bold" },
	"&light .cm-gcodeEvaluated-result": { color: "#0b5cad", fontStyle: "italic" },
	"&dark .cm-gcodeEvaluated-result": { color: "#7fb8ff", fontStyle: "italic" },
});

/** Include once among an editor's extensions to enable `setCurrentLine` - the highlight is invisible
 *  (nothing decorated) until the first `setCurrentLine` call. */
export function gcodeCurrentLine(): Extension {
	return [currentLineField, currentLineTheme];
}

export interface SetCurrentLineOptions {
	/** Scroll the line into view, centered. Default true. Pass false to move the highlight without
	 *  disturbing the current scroll position (e.g. while the user is manually scrolling and a step
	 *  just wants to mark where they'd land). */
	scroll?: boolean;
	/** The line as evaluated, drawn beneath it. Omit (or null) for none - every call replaces the
	 *  previous annotation, so a step that has nothing to show never inherits the last step's. */
	annotation?: CurrentLineAnnotation | null;
}

/**
 * Highlights `line` (1-based) and, by default, scrolls it into view (centered). `line: null` clears
 * the highlight (and any annotation) entirely. A no-op if `gcodeCurrentLine()` isn't part of the
 * view's extensions.
 */
export function setCurrentLine(view: EditorView, line: number | null, options: SetCurrentLineOptions = {}): void {
	const effects: Array<StateEffect<unknown>> = [setCurrentLineEffect.of({ line, annotation: options.annotation ?? null })];
	if (line !== null && options.scroll !== false) {
		const clamped = Math.min(Math.max(1, line), view.state.doc.lines);
		const pos = view.state.doc.line(clamped).from;
		effects.push(EditorView.scrollIntoView(pos, { y: "center" }));
	}
	view.dispatch({ effects });
}
