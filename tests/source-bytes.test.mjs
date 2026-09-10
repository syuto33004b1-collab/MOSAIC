import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #304: a raw NUL in `src/App.test.tsx` made `grep` and `ripgrep` call the biggest test
 * file in the repository binary and print nothing for it.
 *
 * ```
 * $ grep -n "axe.run" src/App.test.tsx
 * Binary file src/App.test.tsx matches
 * ```
 *
 * The count came back but not the lines, so the file was in the results and out of them at
 * the same time. It was there on purpose — a value `String.prototype.includes` could not
 * match, since an empty string matches everything — and as a value it was correct. What it
 * was not is visible: written as a byte rather than an escape, nothing in the source said
 * a control character was there.
 *
 * ## Why a test and not a note
 *
 * Because the failure is silent. Nothing errors; a search simply comes back short, and
 * whoever ran it does not know. It already produced a wrong count and a wrong conclusion
 * about `axe`'s coverage in the session that found it, and AGENTS.md asks for the code to
 * be read before a design is fixed — which for an agent and for a person starts at grep.
 *
 * ## What it checks, and what it does not
 *
 * Every byte of every source file, against tab, newline and carriage return. Nothing about
 * what the characters mean: a file may hold any text it likes, in any language, including
 * escaped control characters, which is what an escape is for. Only the raw bytes that make
 * a text file look binary are refused.
 *
 * It reads whole files rather than streaming them — the largest here is around 240 KB, and
 * the whole sweep is a few dozen files.
 */

const DIRECTORIES = ["src", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css"]);
/** Tab, newline, carriage return: the control bytes a text file is allowed. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

async function sourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)));
}

test("no source file carries a raw control byte", async () => {
  const files = (await Promise.all(DIRECTORIES.map(sourceFiles))).flat();
  // A wrong glob that matched nothing would pass this file silently, which is the same
  // class of quiet failure #304 was.
  assert.ok(files.length > 20, `expected to sweep the sources, found ${files.length} files`);

  const offenders = [];
  for (const file of files) {
    const bytes = await readFile(path.join(root, file));
    for (const [index, byte] of bytes.entries()) {
      if (byte >= 0x20 || ALLOWED.has(byte)) continue;
      const line = bytes.subarray(0, index).reduce((count, value) => value === 0x0a ? count + 1 : count, 1);
      offenders.push(`${file}:${line} has 0x${byte.toString(16).padStart(2, "0")} at byte ${index}`);
    }
  }
  assert.deepEqual(offenders, [],
    "a raw control byte makes grep and ripgrep treat the file as binary and print nothing for it "
    + "(#304). Write it as an escape, or say what you mean without a control character.");
});
