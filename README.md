# dwc-gcode-editor

A CodeMirror-6-based G-code editor core for the [DuetWebControl](https://github.com/Duet3D/DuetWebControl)
plugin family — a purpose-built replacement for Monaco in the plugins that need to view, diagnose,
step through, or edit G-code files, including files far larger than Monaco's own in-memory model can
handle.

Framework-free: no Vue, Vuetify, or DWC-plugin-API imports. A thin Vue wrapper component in each
consuming plugin renders it — see [`duet-gcode-postprocessor`](https://github.com/jaysuk/duet-gcode-postprocessor)
and [`Flexible-Layouts`](https://github.com/jaysuk/Flexible-Layouts).

Driven by [`dwc-gcode-core`](https://github.com/jaysuk/dwc-gcode-core) for tokenising, the G-code
command dictionary, and diagnostics — every fact about what a command means traces back to that
package's own RepRapFirmware-source citations.

See `duet-gcode-postprocessor/docs/gcode-editor-plan.md` for the design this package implements,
including the real, measured reasoning behind replacing Monaco and the CodeMirror 6 choice.

**Status:** early scaffolding, not yet published.

## License

GPL-3.0-or-later
