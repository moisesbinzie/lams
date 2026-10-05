// One-off codemod: replace the `error = err instanceof Error ? ... : '...'` idiom
// with `reportError(err, '...')` across the Svelte routes and components.
//
// Exists because the idiom appears 70 times in near-identical form. Hand-editing
// that is 70 chances to typo a message; this rewrites the whole shape and is
// reviewed with `git diff`. Not part of the app.
//
// Run: node scripts/toast-codemod.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/routes', 'src/lib/components'];

function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else if (entry.name.endsWith('.svelte')) yield path;
	}
}

// `error = err instanceof Error ? err.message : 'Fallback';`
// The catch binding is not always `err`, so it is captured. `\r?` for CRLF files.
const CATCH_ASSIGN =
	/(\w+)\s*=\s*(\w+)\s+instanceof\s+Error\s*\?\s*\2\.message\s*:\s*(['"])((?:[^'"\\]|\\.)*)\3\s*;\r?/g;

const stats = { files: 0, replaced: 0 };

for (const root of ROOTS) {
	for (const path of walk(root)) {
		const src = readFileSync(path, 'utf8');
		let changed = 0;

		let out = src.replace(CATCH_ASSIGN, (_m, state, binding, quote, fallback) => {
			changed += 1;
			return `reportError(${binding}, ${quote}${fallback}${quote});`;
		});

		if (changed === 0) continue;

		// Import the helper once, next to the other $lib imports. Placed after the
		// last existing import so no import block is disturbed.
		if (!/import\s*\{[^}]*reportError[^}]*\}\s*from\s*'\$lib\/lams\/notify\.svelte'/.test(out)) {
			// Match one whole import statement at a time. Two things this must get right,
			// both of which cost a failed run first:
			//  - `^[ \t]*` because these files indent their imports with a tab, so a
			//    bare `^import` anchors against nothing.
			//  - `[^\n]*?` rather than `.*?` so the lazy quantifier cannot cross a
			//    newline and swallow the rest of the script looking for a quote.
			// `\r?` because this repo has CRLF files on Windows, where `$` otherwise
			//    cannot match before the carriage return.
			const imports = [...out.matchAll(/^[ \t]*import\b[^\n]*?from\s+['"][^'"]+['"];\r?/gm)];
			const last = imports[imports.length - 1];
			if (!last) throw new Error(`No import block found in ${path}`);
			const at = last.index + last[0].replace(/\r$/, '').length;
			const eol = out.includes('\r\n') ? '\r\n' : '\n';
			out = `${out.slice(0, at)}${eol}\timport { reportError } from '$lib/lams/notify.svelte';${out.slice(at)}`;
		}

		writeFileSync(path, out);
		stats.files += 1;
		stats.replaced += changed;
		console.log(`${changed.toString().padStart(3)}  ${path}`);
	}
}

console.log(`\n${stats.replaced} call sites across ${stats.files} files`);