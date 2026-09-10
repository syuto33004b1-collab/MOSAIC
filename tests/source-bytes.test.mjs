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
 * ## Two rules, not one
 *
 * NUL is what makes the tools give up on a file. The rest of the C0 range is refused as
 * hygiene rather than as a repeat of #304: an escape says the same thing and can be read.
 *
 * ## What it covers
 *
 * The four source extensions under `src/` and `tests/` — not `supabase/`, `.github/` or
 * `scripts/`, which have no control bytes today and no history of this. Widening it to a
 * repository-wide rule would mean deciding about generated files, binaries and deliberate
 * control characters, which is its own decision.
 *
 * It says nothing about what the characters mean: a file may hold any text it likes, in
 * any language, including escaped control characters, which is what an escape is for.
 */

const DIRECTORIES = ["src", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css"]);
/** Tab, newline, carriage return: the control bytes a text file is allowed. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
const NUL = 0x00;

async function sourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
}

test("the sweep reaches the sources it is for", async () => {
  // A count would pass on twenty unrelated files while missing the one this is about, and
  // would need revisiting every time files merge. Name what has to be in it instead.
  for (const directory of DIRECTORIES) {
    const files = await sourceFiles(directory);
    assert.ok(files.length > 0, `${directory} contributed no files to the sweep`);
  }
  const all = (await Promise.all(DIRECTORIES.map(sourceFiles))).flat().map((file) => file.replaceAll("\\", "/"));
  assert.ok(all.includes("src/App.test.tsx"), "the file #304 was about has to be in the sweep");
  assert.ok(all.includes("src/styles.css"), "the stylesheet has to be in the sweep");
});

test("no NUL, and no other C0 byte, in the swept sources", async () => {
  const files = (await Promise.all(DIRECTORIES.map(sourceFiles))).flat();
  const nuls = [];
  const others = [];
  for (const file of files) {
    const bytes = await readFile(path.join(root, file));
    for (const [index, byte] of bytes.entries()) {
      if (byte >= 0x20 || ALLOWED.has(byte)) continue;
      const line = bytes.subarray(0, index).reduce((count, value) => value === 0x0a ? count + 1 : count, 1);
      const where = `${file}:${line} has 0x${byte.toString(16).padStart(2, "0")} at byte ${index}`;
      (byte === NUL ? nuls : others).push(where);
    }
  }
  assert.deepEqual(nuls, [],
    "a raw NUL makes grep and ripgrep treat the file as binary and print nothing for it (#304). "
    + "Write it as an escape, or say what you mean without a control character.");
  assert.deepEqual(others, [],
    "a raw C0 byte is unreadable in the source even where the tools cope with it. Write it as an escape.");
});
