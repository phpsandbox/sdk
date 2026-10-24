# Manual releases

Run the SDK's release command from this checkout using Node 24 and npm 11. It is
self-contained and does not require another repository or GitHub Actions.

```sh
node scripts/releases/release.mjs plan sdk --ref FULL_40_CHARACTER_COMMIT
node scripts/releases/release.mjs prepare sdk --ref FULL_40_CHARACTER_COMMIT --out /path/to/releases/sdk-VERSION
node scripts/releases/release.mjs apply /path/to/releases/sdk-VERSION
# Explicitly publish the checked package:
node scripts/releases/release.mjs apply /path/to/releases/sdk-VERSION --execute
```

Fetch the reviewed commit first. Preparation clones that exact local commit into
an isolated directory, runs `npm ci` and the production build, then creates an
npm tarball and checksum manifest. Run checks relevant to the changes before
preparation; it does not rerun the full validation suite. Dirty and untracked source files are excluded.
Use a new output directory outside the checkout. The source checkout is unchanged.

Apply verifies the archive, npm tarball and release-tooling checksums. Without
`--execute` it only prints the plan. Execution publishes the prepared tarball,
without rebuilding it. Authenticate with an npm-supported operator session or
token first; GitHub Actions' OIDC identity is unavailable locally. npm may require
an OTP. The version in `package.json` must be unpublished; this command does not
bump versions, merge changes, or choose a commit.

Use `--tag canary` with `plan` and `prepare` to publish a testing release such as
`0.6.0-canary.0`. The version and npm tag are stored in the manifest; `apply` cannot
override the tag. Prerelease versions cannot publish to `latest`, the default tag
for stable versions.

```sh
node scripts/releases/release.mjs prepare sdk --ref FULL_40_CHARACTER_COMMIT --tag canary --out /path/to/releases/sdk-0.6.0-canary.0
```

Increment the prerelease number for each publication. Consumers can install
`@phpsandbox/sdk@canary` to select the newest canary, or pin an exact version for
repeatable deployments. Canary packages are public, but publishing them does not
move the `latest` tag. Publish a normal stable version with `--tag latest` when ready.

After successful publication, create and push `vVERSION` at the exact manifest
commit. Check that an existing tag points there before reusing it. Never move an
existing release tag. A package cannot be rolled back in place; publish a corrected
patch version instead.

`attempt.json` records an execution before publishing. `completed.json` is written
only after success. A second execution of the same output directory is refused.
After failure or interruption, inspect the registry before retrying: publication
may already have succeeded. Prepare into a new directory after resolving state.
A changed release-tooling checksum also requires fresh preparation.

The archive contains source code; keep release directories private. Failed
preparation leaves its isolated `source` directory for diagnosis and writes no
releasable manifest. No live smoke tests are run by preparation.

Validate this command with:

```sh
node --test scripts/releases/release.test.mjs
npm run check
./node_modules/.bin/oxfmt --check scripts/releases
```
