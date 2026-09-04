- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.

- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

- Do not preserve backward compatibility.
- Choose the simplest implementation that fully meets the current requirements.
- Prefer established, well-maintained libraries over custom implementations.

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- A dependency that **parses or deserializes** already-decrypted user data — turns bytes or text read back from storage into a structure of its own (an index, a tree, an object graph) — never travels in a grouped batch of the dependency pass (`/build:deps`): it is upgraded as its own item, with its changelog read, even for a patch. Rendering or transforming values the app has already parsed is not this class (that is `react`); today the class holds only `minisearch` (`apps/app/src/features/nota-biblioteca`), and the reasoning is in `docs/adr/0010-minisearch-fica-em-intervalo-o-lockfile-e-o-pin.md`.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

- Write comments only for what the code cannot say: a *why*, a constraint, a decision that looks wrong without context. Never restate what the line below already shows.
- Keep a comment block to 3 lines of text. `comments/no-long-comments` (oxlint, `tools/oxlint-plugin-comments`) fails the lint above that, in every workspace and in CI. Longer explanations belong in the module README, an ADR, or the spec — not inline.
- Tool directives (`eslint-disable`, `Stryker disable`, `@ts-expect-error`, ...) are exempt and never counted.

- Keep every branch synced with `origin/main` at all times, in both harnesses. Planning (`/plan:*`) branches off a freshly fetched `main`; implementation (`/build:*`) merges `origin/main` into the working branch at the start of each ticket, before each commit, and before opening the MR. Resolve conflicts one merge at a time, then re-run the gates that the merge could break (`pnpm -r --if-present lint`, the affected `test:unit`, `check:i18n-extract`, `check:i18n-complete`, `tsc -b`).
- `tools/branch-sync-guard.mjs` (PreToolUse hook, `.claude/settings.json`) enforces this: a `git commit`, `git push` or new branch on a branch behind `origin/main` is refused until the merge happens. The merge itself is never blocked.
