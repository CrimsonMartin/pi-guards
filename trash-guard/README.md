# pi-trash-guard

Pi [extension](https://pi.dev) that stops agents from irreversibly deleting
files. It intercepts the `bash` tool before execution and rewrites `rm` to
`trash-put` (from [trash-cli](https://pypi.org/project/trash-cli/)), so
everything an agent "deletes" is recoverable via `trash-list` /
`trash-restore`.

| Pattern | Behavior |
|---|---|
| `rm foo.txt`, `rm -rf node_modules`, `rm -irf ./logs` | Rewritten to `trash-put` (flags mapped: `-f`/`-i` kept, `-r/-R/--recursive` dropped since trash-put handles dirs, unknown flags dropped). No prompt. |
| `rm` of **absolute paths** (`rm -rf /home/...`, `rm -rf /tmp/x`, `rm -rf /`) | Rewritten to `trash-put` **and requires your confirmation** in the TUI. Headless runs: blocked outright. |
| `shred` / `srm` | Blocked — irreversible by design. |
| `trash-empty` | Requires confirmation (permanently deletes trashed files). |
| anything else | Untouched (`git rm`, `find -delete`, `trash-*`, `echo rm ...`, …). |

The tokenizer is quote/shell-aware (pipes, `;`, `&&`, backticks, newlines)
and only matches exact command-segment positions.

## Install

```
pi install npm:@crimsonmartin/pi-trash-guard
```

Prerequisite (system-level):

```
sudo apt install trash-cli   # provides trash-put / trash-list / trash-restore
```


## Tests

```
npm install
npm test
```

Run from this directory.
