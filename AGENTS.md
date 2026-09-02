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
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

- Write comments only for what the code cannot say: a *why*, a constraint, a decision that looks wrong without context. Never restate what the line below already shows.
- Keep a comment block to 3 lines of text. `comments/no-long-comments` (oxlint, `tools/oxlint-plugin-comments`) fails the lint above that, in every workspace and in CI. Longer explanations belong in the module README, an ADR, or the spec — not inline.
- Tool directives (`eslint-disable`, `Stryker disable`, `@ts-expect-error`, ...) are exempt and never counted.
