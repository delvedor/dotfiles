/**
 * Confirm Destructive Actions Extension
 *
 * Prompts for confirmation before destructive session actions (clear, switch, fork).
 * Demonstrates how to cancel session events using the before_* events.
 */

import type {
	ExtensionAPI,
	SessionBeforeForkEvent,
	SessionBeforeSwitchEvent,
	SessionEntry,
	SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
	return entry.type === "message";
}

/**
 * True when the most recent message in the branch is a user message,
 * i.e. there is at least one user message that has not yet received an
 * assistant response. Pure tail-scan — O(n) worst case, O(1) typical.
 */
function hasUnansweredUserMessage(entries: readonly SessionEntry[]): boolean {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!isMessageEntry(entry)) continue;
		return entry.message.role === "user";
	}
	return false;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_before_switch", async (event: SessionBeforeSwitchEvent, ctx) => {
		if (!ctx.hasUI) return;

		if (event.reason === "new") {
			const confirmed = await ctx.ui.confirm(
				"Clear session?",
				"This will delete all messages in the current session.",
			);

			if (!confirmed) {
				ctx.ui.notify("Clear cancelled", "info");
				return { cancel: true };
			}
			return;
		}

		// reason === "resume" — only warn when there's a user message that
		// hasn't been answered yet (work in flight).
		if (!hasUnansweredUserMessage(ctx.sessionManager.getEntries())) return;

		const confirmed = await ctx.ui.confirm(
			"Switch session?",
			"You have an unanswered message in the current session. Switch anyway?",
		);

		if (!confirmed) {
			ctx.ui.notify("Switch cancelled", "info");
			return { cancel: true };
		}
	});

	pi.on("session_before_fork", async (event: SessionBeforeForkEvent, ctx) => {
		if (!ctx.hasUI) return;

		const confirmed = await ctx.ui.confirm(
			"Fork session?",
			`Create a new branch from entry ${event.entryId.slice(0, 8)}?`,
		);

		if (!confirmed) {
			ctx.ui.notify("Fork cancelled", "info");
			return { cancel: true };
		}
	});
}
