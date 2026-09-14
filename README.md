# pi-guards

[![CI](https://github.com/CrimsonMartin/pi-guards/actions/workflows/ci.yml/badge.svg)](https://github.com/CrimsonMartin/pi-guards/actions/workflows/ci.yml)
[![Secret Scan](https://github.com/CrimsonMartin/pi-guards/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/CrimsonMartin/pi-guards/actions/workflows/secret-scan.yml)
[![Publish](https://github.com/CrimsonMartin/pi-guards/actions/workflows/publish.yml/badge.svg)](https://github.com/CrimsonMartin/pi-guards/actions/workflows/publish.yml)

Safety extensions for [pi](https://pi.dev) that keep agents from doing slow
or destructive things in the `bash` tool. Two independent packages:

| Package | What it does |
|---|---|
| [`find-guard`](./find-guard) | Blocks raw `find /...` and `grep -r` (multi-minute filesystem walks); points agents at `locate` (plocate index, ~ms) and `rg` (ripgrep) |
| [`trash-guard`](./trash-guard) | Rewrites `rm` to `trash-put` (trash-cli) so nothing an agent deletes is ever unrecoverable; confirms before trashing absolute paths; blocks `shred`/`srm` |

Both are zero-config: drop the package in, `/reload`, done. Both pass their
test suites (22 + 30 cases).

## Install

```
pi install npm:@crimsonmartin/pi-find-guard
pi install npm:@crimsonmartin/pi-trash-guard
```

Prerequisites (system-level):

```
# find-guard's locate suggestion:
sudo apt install plocate      # or mlocate on older distros
sudo updatedb

# trash-guard:
sudo apt install trash-cli
```

## Releasing

Tag it — that's the only version you write:

```
git tag v0.2.0 && git push origin v0.2.0
```

The `Publish` workflow sets each package's `version` from the tag, runs the
tests, publishes both to npm via [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/),
and commits the version bumps back to `main`.

**One-time OIDC setup** (on npmjs.com, once per package):
Packages → *your-package* → Settings → **Trusted publishing** →
*Add trusted publisher* → **GitHub Actions**, then:

| Field | Value |
|---|---|
| Organization or user | `CrimsonMartin` |
| Repository | `pi-guards` |
| Workflow filename | `publish.yml` |

No `NPM_TOKEN` repo secret is needed — the workflow uses `id-token: write`
and npm mints short-lived publish tokens per run.

Re-tagging the same version to re-run the workflow is fine — npm refuses to
re-publish a version that's already out, so the publish step fails harmlessly
if the version is unchanged on npm.

## Development

Each package is self-contained with its own tests:

```
cd find-guard   # or trash-guard
npm install
npm test
```
