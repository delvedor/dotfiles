/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 *
 * Allowlist precedence:
 *   1. DESTRUCTIVE_PATTERNS always wins. If any destructive pattern matches the
 *      command (anywhere — to catch chained / substituted shell forms), the
 *      command is rejected even if a safe pattern also matches.
 *   2. SAFE_PATTERNS must then match (as a prefix anchor). Anything else is
 *      rejected by default.
 *
 * Notes on tightening:
 *   - curl/wget downloads to a file (`-o`, `-O`, `--output`) are treated as
 *     destructive — only stdout-streaming forms (`wget -O -`) remain safe.
 *   - awk is intentionally NOT in the safe list because it can write to files
 *     via shell-style redirection inside its program body.
 */

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
	// Network downloads that write to disk.
	/\bcurl\b[^|;&]*\s(-o|-O|--output)(\s|=)/i,
	/\bwget\b[^|;&]*\s-O\s+(?!-(\s|$))\S/i,
	/\bwget\b[^|;&]*\s--output-document(\s|=)(?!-(\s|$))/i,
	// curl POST / form / upload (exfil channels).
	/\bcurl\b[^|;&]*\s(-d|--data|--data-binary|--data-raw|-F|--form|-T|--upload-file)\b/i,
	// `find` flags that write/delete (subset of common write-capable flags).
	/\bfind\b[^|;&]*\s-delete\b/i,
	/\bfind\b[^|;&]*\s-fprint(f|0)?\b/i,
	/\bfind\b[^|;&]*\s-fls\b/i,
	// `find -exec` / `find -execdir` run arbitrary commands.
	/\bfind\b[^|;&]*\s-exec(dir)?\b/i,
	// === Code execution gates ===
	// Piping into a shell or scripting interpreter (the classic `curl … | bash`).
	/\|\s*(sh|bash|zsh|ksh|dash|ash|fish|csh|tcsh)\b/i,
	/\|\s*(python|perl|ruby|node|deno|bun|php|lua|osascript|Rscript)\d*\b/i,
	// Shell built-ins that execute strings. These also cover the piped forms
	// (`cmd | xargs`, `cmd | eval`) via word boundaries — no separate pipe rule needed.
	/\beval\b/i,
	/\bxargs\b/i,
	// Command substitution: `$(...)` and backticks.
	/\$\(/, // matches the opening of $( ... )
	/`/, // backticks (matches any single backtick char in the command)
	// Network shells / remote command execution.
	/\b(nc|ncat|netcat|socat|telnet|ssh|scp|sftp|rsync|ftp)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	// `wget -O -` is intentionally NOT listed: the destructive `|\s*(sh|bash|…)`
	// patterns above already neutralise the `wget -O- … | bash` RCE bridge, and
	// leaving the explicit SAFE entry just invites a regression if someone
	// loosens those rules. Use `curl` for read-only HTTP fetches.
	/^\s*curl\s/i,
	/^\s*jq\b/,
	// `sed` deliberately omitted — even `sed -n` can write via the `w` flag in a
	// script body and `-i` does in-place editing. Use `grep`/`awk` if you need
	// extraction (well, awk is also out, see below).
	// `awk` deliberately omitted — its program body can shell out and redirect.
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}
