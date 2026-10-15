---
name: typescript-quality
description: Write and review TypeScript with deliberate state models, narrow types, explicit async ownership, and the repository's existing quality tools. Use for TypeScript implementation or refactoring in SDKs, CLIs, servers, and Workers.
---

# TypeScript quality

Inspect the nearest package.json, lockfile, tsconfig, lint configuration, and comparable source before editing. Respect the installed runtime and module system; Bun, Node, browsers, and Workers have different capabilities.

- Reuse existing domain types and parse unknown data at external boundaries. Use narrowing and runtime validation rather than `as`, `any`, double assertions, or non-null assertions to conceal missing guarantees. A justified interop assertion should be narrow and supported by an invariant.
- For workflows with mutually exclusive modes or mode-specific data, consider a discriminated union instead of independent flags. Keep genuinely independent booleans independent; do not build a state machine for trivial state.
- Derive values instead of maintaining synchronized copies. Keep state changes with the operation that owns them and make reset/cancellation behavior explicit.
- Handle promise rejection and lifecycle ownership. Await required work; use the runtime's supported mechanism for background work. Do not discard promises to satisfy lint.
- Preserve typed public contracts, error semantics, and module boundaries. Use exhaustive handling where a closed union should force callers to handle new cases.
- Prefer clear functions and named intermediate values to compressed nested expressions. Extract shared logic when it has a coherent responsibility; avoid generic frameworks for one caller.

## Validation and tests

- Parse boundary input once into a trustworthy type. Do not validate an array with `every`, then repeat the same checks in a filtering/copy loop, or cast a transformed value back to a contract without proving the transformation preserves it. Prefer an existing schema/type guard whose result carries the validated type.
- Write straight-line tests with unconditional assertions. Use the installed runner's `toThrow`, `rejects`, or equivalent instead of manual `try`/`catch`; split alternative expectations into named cases. Use a typed assertion from the installed assertion library (or a small test helper when needed) to fail and narrow values, rather than `if (value instanceof Type) { expect(...) }` or a cast.
- Register cleanup as resources are acquired, using hooks or cleanup callbacks rather than repeated `try`/`finally` wrappers. Await teardown of child processes and servers. Keep process/protocol orchestration in a focused test helper with bounded waits and useful failure output when it would obscure the scenario.
- Keep HTTP fakes focused on request/response contracts, with explicit fixtures or response sequences and a failing fallback for unexpected requests. Do not implement a second configuration engine or provider policy inside a command test. Assert outgoing data independently of the production normalizer being tested.
- Separate setup, invocation, assertions, and later lifecycle transitions with blank lines. Assert the exact outcome the test claims, including relevant request counts and payloads, rather than merely that some error occurred.

Use installed formatting, lint, typecheck, and test scripts. For typed linting, retain the repository's existing typescript-eslint or Oxlint approach. Inspect supported rules and TS version compatibility before proposing configuration changes. Do not install a second formatter by default or change strictness without measuring the effect.

Consult these official references for the relevant question, matching installed versions:

- [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/)
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/)
- [Oxlint documentation](https://oxc.rs/docs/guide/usage/linter.html)

Review the final diff for unsafe casts, duplicated state, unhandled work, API drift, and complexity that checks cannot detect. Verify behavior at the appropriate boundary rather than writing tests that mirror implementation details.
