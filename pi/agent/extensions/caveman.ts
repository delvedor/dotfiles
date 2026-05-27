/**
 * Caveman Extension
 *
 * Ultra-compressed communication mode. Reduces token usage by having the LLM
 * respond with maximum terseness while keeping full technical accuracy.
 *
 * Levels: lite, full, ultra (+ off to disable)
 * Default: full
 *
 * Usage:
 *   pi --caveman ultra          Start in ultra mode
 *   pi --caveman off            Start with caveman disabled
 *   /caveman                    Interactive level selector
 *   /caveman full               Switch directly to full mode
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type CavemanLevel = "off" | "lite" | "full" | "ultra";

export interface CavemanStatus {
	level: CavemanLevel;
}

const LEVELS: readonly CavemanLevel[] = ["off", "lite", "full", "ultra"];

function isValidLevel(value: string): value is CavemanLevel {
	return (LEVELS as readonly string[]).includes(value);
}

const LEVEL_DESCRIPTIONS: Record<CavemanLevel, string> = {
	off: "disabled — normal responses",
	lite: "no filler/hedging, full sentences kept",
	full: "drop articles, fragments OK — classic caveman",
	ultra: "abbreviate prose, arrows for causality, maximum compression",
};

// ── System prompt strings ─────────────────────────────────────────────────────

const CAVEMAN_BASE = `\
## Caveman Mode — Active

Respond terse like smart caveman. All technical substance preserved. Only fluff removed.

**Persistence:** Active every response until user uses /caveman off. No drift back to verbose after many turns.

**Always unchanged:** technical terms, code blocks, commit messages, PR descriptions, error strings.

**Auto-Clarity — temporarily revert to full prose for:**
- Security warnings or confirmations of irreversible actions
- Multi-step sequences where omitting conjunctions risks misread order
- Cases where compression creates technical ambiguity (e.g. "migrate table drop column backup first")
- When user asks to clarify or repeats the same question
Resume caveman immediately after the clear section ends.`;

const LEVEL_INSTRUCTIONS: Record<Exclude<CavemanLevel, "off">, string> = {
	lite: `\
**Level: lite**
Remove filler and hedging only. Keep articles (a/an/the) and complete sentence grammar. Professional but tight.
Drop: "just", "really", "basically", "actually", "simply", "sure", "certainly", "of course", "happy to", "I'd be happy to help".`,

	full: `\
**Level: full** (classic caveman)
Drop articles (a/an/the). Fragments OK. Use short synonyms (big not extensive, fix not "implement a solution for", use not "utilize").
Pattern: [thing] [action] [reason]. [next step].
Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use < not <=. Fix:"`,

	ultra: `\
**Level: ultra**
Abbreviate prose words: DB, auth, config, req, res, fn, impl, msg, err, val, param.
Strip conjunctions. Use → for causality. One word when one word enough.
Code symbols, function names, API names, error strings: never abbreviate.
Not: "The new object reference created on each render causes a re-render."
Yes: "Inline obj → new ref → re-render. useMemo."`,
};

export function buildPrompt(level: Exclude<CavemanLevel, "off">): string {
	return `${CAVEMAN_BASE}\n\n${LEVEL_INSTRUCTIONS[level]}`;
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function cavemanExtension(pi: ExtensionAPI): void {
	let level: CavemanLevel = "full";

	function emitStatus(): void {
		const status: CavemanStatus = { level };
		pi.events.emit("caveman:status", status);
	}

	// ── CLI flag ────────────────────────────────────────────────────────────────

	pi.registerFlag("caveman", {
		description: "Caveman compression level on startup (off, lite, full, ultra)",
		type: "string",
	});

	// ── Lifecycle ───────────────────────────────────────────────────────────────

	pi.on("session_start", (_event, ctx) => {
		const flag = pi.getFlag("caveman");
		if (typeof flag === "string" && flag !== "") {
			if (isValidLevel(flag)) {
				level = flag;
			} else {
				ctx.ui.notify(`caveman: unknown level "${flag}" — defaulting to full`, "warning");
				level = "full";
			}
		} else {
			level = "full";
		}
		emitStatus();
	});

	pi.on("before_agent_start", (event) => {
		if (level === "off") return undefined;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildPrompt(level)}`,
		};
	});

	// ── /caveman command ────────────────────────────────────────────────────────

	pi.registerCommand("caveman", {
		description: "Set caveman communication level (off, lite, full, ultra)",
		getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
			const items = LEVELS.map((l) => ({
				value: l,
				label: l,
				description: LEVEL_DESCRIPTIONS[l],
			}));
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args?.trim().toLowerCase() ?? "";

			// Direct level switch
			if (arg && isValidLevel(arg)) {
				level = arg;
				emitStatus();
				ctx.ui.notify(`Caveman: ${level}`, "info");
				return;
			}

			// Unknown arg
			if (arg) {
				ctx.ui.notify(`Unknown level "${arg}". Valid: ${LEVELS.join(", ")}`, "error");
				return;
			}

			// Interactive selector — annotate current level with "(active)"
			const displayItems = LEVELS.map((l) => (l === level ? `${l} (active)` : l));
			const selected = await ctx.ui.select("Caveman level:", displayItems);
			if (selected == null) return;

			const idx = displayItems.indexOf(selected);
			if (idx === -1) return;
			level = LEVELS[idx]!;
			emitStatus();
			ctx.ui.notify(`Caveman: ${level}`, "info");
		},
	});
}
