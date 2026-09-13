# pi-guards

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

## Development

Each package is self-contained with its own tests:

```
cd find-guard   # or trash-guard
npm install
npm test
```
