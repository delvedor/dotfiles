/**
 * Dracula Theme Extension for pi.dev
 *
 * Auto-activates the Dracula theme and provides theme-related utilities.
 *
 * Dracula color palette:
 * - Purple #BD93F9 - Keywords, accent
 * - Pink   #FF79C6 - Strings, secondary accent
 * - Cyan   #8BE9FD - Functions, links, primary accent
 * - Green  #50FA7B - Success, added lines
 * - Yellow #F1FA8C - Warnings, strings
 * - Orange #FFB86C - Variables, bash mode
 * - Red    #FF5555 - Errors, removed lines
 * - Background #282A36 - Dark background
 * - Foreground #F8F8F2 - Main text
 * - Comment    #6272A4 - Muted text, borders
 * - Selection  #44475A - Selection bg
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Dracula color constants (single source of truth — hex).
export const DRACULA = {
	purple: "#BD93F9",
	pink: "#FF79C6",
	cyan: "#8BE9FD",
	green: "#50FA7B",
	yellow: "#F1FA8C",
	orange: "#FFB86C",
	red: "#FF5555",
	bg: "#282A36",
	fg: "#F8F8F2",
	dim: "#6272A4",
	selection: "#44475A",
} as const;

type DraculaKey = keyof typeof DRACULA;

function hexToRgb(hex: string): readonly [number, number, number] {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return [r, g, b];
}

function ansiFg(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m`;
}

// ANSI truecolor helpers derived from DRACULA (one source of truth).
// The explicit Record type widens values to `string`, so a trailing `as const`
// here would be a no-op — omitted intentionally.
export const C: Record<DraculaKey, string> & { reset: string } = {
	purple: ansiFg(DRACULA.purple),
	pink: ansiFg(DRACULA.pink),
	cyan: ansiFg(DRACULA.cyan),
	green: ansiFg(DRACULA.green),
	yellow: ansiFg(DRACULA.yellow),
	orange: ansiFg(DRACULA.orange),
	red: ansiFg(DRACULA.red),
	bg: ansiFg(DRACULA.bg),
	fg: ansiFg(DRACULA.fg),
	dim: ansiFg(DRACULA.dim),
	selection: ansiFg(DRACULA.selection),
	reset: "\x1b[0m",
};

const PALETTE_ENTRIES: ReadonlyArray<readonly [DraculaKey, string, string]> = [
	["purple", DRACULA.purple, "Keywords, accent"],
	["pink", DRACULA.pink, "Strings"],
	["cyan", DRACULA.cyan, "Functions, links"],
	["green", DRACULA.green, "Success"],
	["yellow", DRACULA.yellow, "Warnings"],
	["orange", DRACULA.orange, "Variables"],
	["red", DRACULA.red, "Errors"],
	["dim", DRACULA.dim, "Comment / muted"],
];

function formatInfo(): string {
	const rows = PALETTE_ENTRIES.map(
		([key, hex, label]) => `  ${C[key]}${key.padEnd(7)} ${hex}${C.reset} - ${label}`,
	).join("\n");
	return `Dracula Theme\n\nPalette:\n${rows}\n\nLocation: ~/.pi/agent/themes/dracula.json`;
}

function formatColors(): string {
	return PALETTE_ENTRIES.map(([key, , label]) => `${C[key]}████${C.reset} ${label} (${key})`).join("\n");
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		// Theme is auto-loaded from ~/.pi/agent/themes/dracula.json
		ctx.ui.setStatus("dracula", ctx.ui.theme.fg("accent", "🧛 Dracula"));

		// Re-emit on every session_start so late subscribers (other extensions
		// that load after this one) can still receive the palette.
		pi.events.emit("dracula:colors", DRACULA);
	});

	pi.registerCommand("dracula", {
		description: "Dracula theme info and utilities",
		handler: async (args, ctx) => {
			const subcmd = args.trim() || "info";

			switch (subcmd) {
				case "info": {
					ctx.ui.notify(formatInfo(), "info");
					break;
				}
				case "colors":
				case "palette": {
					ctx.ui.notify(formatColors(), "info");
					break;
				}
				default: {
					ctx.ui.notify("Usage: /dracula [info|colors|palette]", "error");
				}
			}
		},
	});
}
