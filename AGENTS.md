## Portable repository guidance

These standards apply to this repository on every machine. They are self-contained; no user-level instructions or locally installed skills are required. Read relevant repository-local skills when available. For uncovered topics, use official documentation matching installed versions.

Work in the primary repository checkout by default, even when it has unrelated uncommitted changes, provided the requested changes do not overlap. Preserve all existing changes and stage only task-specific files. If switching branches or editing would conflict with existing work, explain the conflict before creating a worktree. If a worktree is necessary, use a visible adjacent directory, tell me its path immediately, and move the branch back to the primary checkout when finished.

## Code quality standards

- Treat readability, maintainability, and consistency with the application as completion requirements alongside working behavior. Deliver production-quality code unless the user explicitly asks for a disposable prototype.
- Before implementing, read the applicable repository instructions and rules, inspect comparable code, and search for existing components, utilities, types, and framework facilities. Reuse established patterns rather than inventing parallel infrastructure.
- Confirm installed language and package versions, package manager, and available scripts before relying on APIs or commands. Consult official documentation for version-sensitive behavior. Do not silently upgrade dependencies or replace a repository's toolchain.
- Use descriptive names appropriate to the language, straightforward control flow, cohesive functions, and explicit ownership boundaries. Avoid compressed expressions, unrelated combined declarations, excessive nesting, and abstraction without a concrete benefit. Follow the repository formatter for whitespace and layout.
- In PHP and JavaScript/TypeScript, use braces for control-flow bodies, including short guards. Keep declarations and logical sections easy to scan; avoid saving lines at the expense of readability.
- Separate changes of context with one blank line: imports from declarations; completed guards from the work that follows; setup, action, and assertions in tests; and distinct lifecycle steps. Keep tightly related statements together. Do not insert blank lines between every statement or remove intentional paragraph breaks to save space.
- Model state deliberately. Keep independent concerns separate; group values that share a lifecycle. Represent mutually exclusive workflow states explicitly when independent flags permit invalid combinations. Derive values instead of synchronizing duplicate state. Avoid opening/closing handlers that must manually reset unrelated state.
- Keep domain logic, transport, presentation, and infrastructure responsibilities at the boundaries established by the project. Extract components or functions when they clarify ownership or reuse; do not fragment simple code just to reduce file length.
- Prefer runtime checks, narrowing, and correct types over assertions, unsafe casts, non-null assertions, or suppression comments. Validate untrusted input at boundaries. Do not weaken checks to make new code pass.
- Reuse existing accessible UI primitives for dialogs, focus management, menus, notifications, and similar behavior. Clean up timers, listeners, subscriptions, requests, and global effects when their owner ends.
- Before reporting completion, review the entire task diff for unnecessary complexity, duplicated logic, fragile state transitions, missing cleanup, unsafe types, and departures from local conventions. Fix issues found in that review. Passing tests does not replace this review.
- Run the repository's formatter, lint/static analysis, type checks, and relevant tests for the changed area. Use focused checks during development and the required project gate before delivery. Check command definitions first: some lint scripts mutate files. Preserve unrelated changes and avoid repository-wide formatting churn.
- Be precise about verification: distinguish passing checks, existing failures, unavailable tools, and checks not run. Never describe a configured check as enforced unless its failure actually fails the relevant CI gate.

## Test readability

- In PHP and JavaScript/TypeScript test scenarios, use a straight-line arrange/act/assert flow. Do not use `if`/`else`, ternaries, or manual `try`/`catch` to choose whether or what to assert. Use separate named cases or datasets for alternative outcomes and the test framework's exception/rejection assertions for expected failures.
- Assertions must run unconditionally. Assert required values and types with a failure-producing assertion or typed assertion helper; never skip an assertion when a value is absent or has the wrong shape. Do not replace a conditional assertion with an unsafe cast.
- Register cleanup with the test framework's lifecycle hooks or cleanup callbacks as soon as a resource, fake, stub, or process is acquired. Avoid wrapping test bodies in `try`/`finally` when framework cleanup can own restoration. Keep cleanup reliable when setup or assertions fail.
- Give each test one coherent behavior. A retry, revocation, or recovery lifecycle may contain several actions, but separate its phases with blank lines and assert each transition. Put unrelated failure modes in separate tests or named parameterized cases.
- Keep test doubles small and explicit. Branching inside a fake HTTP router or protocol simulator is allowed to serve the required scenarios; it must not conditionally suppress assertions or recreate the domain implementation. Fail unexpected requests instead of returning generic success.
- Assert the invariant named by the test: relevant status/error codes, request payloads, call counts, identities across retries, and resulting state. Checking for any error or any one matching request is insufficient when the behavior requires a specific outcome or every attempt to satisfy a contract.

## Project guidance

- Preserve public API and generated declaration compatibility, browser/Node boundaries, and existing error/transport ownership.
- Model exported contracts explicitly; narrow unknown data at protocol boundaries. Avoid leaking internal provider shapes or masking incompatible contracts with assertions.
- Use the repository's npm scripts for tests and builds, relevant smoke type checks, and package validation when changing distribution. Do not run live smoke suites without checking their side effects and prerequisites. Use configured formatting/lint checks when present; report missing enforcement rather than inventing a passing gate.

## Repository skills

Read the relevant skill before implementation or review. These files are committed with the repository and require no machine-local installation.

- [typescript-quality](.agents/skills/typescript-quality/SKILL.md): Write and review TypeScript with deliberate state models, narrow types, explicit async ownership, and the repository's existing quality tools. Use for TypeScript implementation or refactoring in SDKs, CLIs, servers, and Workers.

## Maintaining enforcement

- Prefer the existing formatter and linter in each repository. Add missing check scripts/CI gates when that work is requested; keep checks non-mutating in CI and provide a separate fix command.
- Formatting tools own layout. Linters/static analysis own mechanically detectable problems. State modeling, component reuse, ownership, and appropriate abstraction remain required implementation and diff-review responsibilities.
- When strengthening a rule set, first measure existing violations and agree the migration scope through the task context. Do not blanket-disable rules, hide violations with broad ignores, or reformat unrelated code to obtain a green check.
- When a review exposes a recurring quality gap or the user states a preference, update the smallest relevant repository instruction or skill with an actionable rule and a useful example when needed. Check for conflicting guidance, keep language-specific idioms intact, and avoid duplicating the same detailed rule across multiple skills. Review only new or changed code against the rule unless a wider migration is requested.
