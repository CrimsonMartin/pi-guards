# pi-find-guard

Pi [extension](https://pi.dev) that stops agents from walking entire
filesystems with raw shell commands. It intercepts the `bash` tool before
execution and **blocks** the slow patterns, pointing the agent at the fast
alternative:

| Blocked pattern | Suggested instead |
|---|---|
| `find /...` (any absolute path: `/`, `/home/...`, `/mnt/...`, `/dev`, …) | `locate <pattern>` (mlocate/plocate index, ~ms) |
| `grep -r` / `-R` / `--recursive` (incl. combined flags like `-rn`) | `rg "pattern" [path]` (ripgrep) |

Scoped searches (`find . -name x`, `find ./src ...`) pass through untouched,
as do `find -exec`, `find -type d -name x`, `sudo find ...`, `find` inside
`$(...)`, and any `find` mentioned in a string. The tokenizer is
quote/shell-aware (pipes, `;`, `&&`, backticks, newlines).

## Install

```
pi install npm:@crimsonmartin/pi-find-guard
```

Prerequisite (system-level, for the `locate` suggestion):

```
sudo apt install plocate     # or mlocate on older distros
sudo updatedb
```


## Example block

```
$ find / -iname "Valheim.dll" 2>/dev/null | head
→ Blocked: raw `find / ...` walks a large tree and takes minutes. Use locate instead:
  locate Valheim.dll   # answers in ~ms from the locate index
  locate Valheim.dll -b | grep '/$'   # if you need directories
```

## Tests

```
npm install
npm test
```

Run from this directory.
