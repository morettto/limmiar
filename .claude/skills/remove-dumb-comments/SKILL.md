---
name: remove-dumb-comments
description: Find and delete comments that only restate the code, keeping the ones that carry a why. Use when the user asks to clean up comments, says "remove dumb comments", complains about comment slop, or when `comments/no-long-comments` warnings pile up.
---

# Remove dumb comments

A comment earns its place only when it says something the code cannot: why a
decision was made, a constraint from outside the file, a trap the next reader
would otherwise fall into. Everything else is noise that ages into a lie.

## Usage

- `/remove-dumb-comments` — the 10 lowest-value comments in the repo.
- `/remove-dumb-comments <n>` — the n lowest-value comments.
- `/remove-dumb-comments all` — every low-value comment.
- `/remove-dumb-comments <path>` — restrict the pass to a file or directory.

## How to run the pass

1. Collect candidates. Long blocks first — `pnpm --filter <pkg> lint` reports
   `comments/no-long-comments` for anything over 3 lines. Then grep the rest:
   `grep -rn "^\s*//\|^\s*\*" --include=*.ts --include=*.tsx --include=*.cs src`.
2. Read each candidate against the code it sits on, not on its own. A comment
   is only redundant once you have checked the code actually says the same thing.
3. Rank by how little the comment adds, worst first.
4. Show the user the list — `file:line`, the comment, the verdict — then delete
   the ones they confirm. Never delete silently in bulk.
5. Run the package's tests and lint after the deletions.

## Delete

- Restatements: `// increment the counter` over `counter++`.
- Section banners and decoration: `// ---- helpers ----`, boxed ASCII headers.
- Signatures already in the types: a JSDoc `@param`/`@returns` block that repeats
  a typed parameter list and adds nothing.
- Changelog and attribution notes: `// added in S08-02`, `// fixed by ...` — git
  already holds this.
- Commented-out code. It is in the history.
- Prose essays: paragraphs of design narrative inline. Move the surviving idea
  to the module README or an ADR, then delete the block.
- Comments that no longer match the code. Wrong is worse than absent.

## Never delete

- The why behind a non-obvious choice: a workaround, an ordering constraint, a
  performance trade-off, a spec or legal requirement.
- Links to an issue, spec, RFC, or vendor bug that explains the shape of the code.
- Warnings about what breaks if the code is changed or reordered.
- `ponytail:` markers naming a known ceiling and its upgrade path.
- Directives the toolchain reads: `oxlint-disable`, `@ts-expect-error`,
  `eslint-disable`, pragmas, license headers.
- Comments inside a test that state the scenario being pinned down when the test
  name cannot hold it.

## Rewriting instead of deleting

When a long block holds one real why buried in prose, do not delete it — cut it
to that single sentence, 3 lines or fewer. When the comment exists because a
name is bad, rename the symbol and drop the comment.
