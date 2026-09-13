import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

/**
 * find-guard: keep agents from walking entire filesystems with raw find/grep.
 *
 * Blocks (no rewriting) slow raw-shell patterns and points at the fast path:
 * - `find /...`  (any absolute path — /, /home, /mnt, /dev, …)
 *     → suggest `locate` (mlocate/plocate index, ~ms) or scoped `fd`.
 * - `grep -r/-R/--recursive`
 *     → suggest `rg` (ripgrep, already on PATH).
 *
 * Conservative: tokenizes the command (quote/shell-aware), only matches
 * exact command-segment positions; anything unrecognized passes through.
 *
 * Install: drop in ~/.pi/agent/extensions/ (global) or .pi/extensions/ (project).
 * Prereq for the locate suggestion: `apt install mlocate` (or plocate) + `sudo updatedb`.
 */

type Tok = { type: "cmd" | "sep"; text: string };

function tokenize(command: string): Tok[] {
  const tokens: Tok[] = [];
  const cur: string[] = [];
  const flush = (sep?: string) => {
    if (cur.length) tokens.push({ type: "cmd", text: cur.join(" ") });
    cur.length = 0;
    if (sep) tokens.push({ type: "sep", text: sep });
  };
  let i = 0;
  const n = command.length;
  while (i < n) {
    const ch = command[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (q === "'") {
          if (command[j] === "'") break;
          j++;
          continue;
        }
        if (command[j] === "\\") {
          j += 2;
          continue;
        }
        if (command[j] === '"') break;
        j++;
      }
      cur.push(command.slice(i, Math.min(j + 1, n)));
      i = j + 1;
      continue;
    }
    if (ch === "\\") {
      cur.push(command.slice(i, Math.min(i + 2, n)));
      i += 2;
      continue;
    }
    if (ch === "&" && i + 1 < n && command[i + 1] === "&") {
      flush("&&");
      i += 2;
      continue;
    }
    if (ch === "|" && i + 1 < n && command[i + 1] === "|") {
      flush("||");
      i += 2;
      continue;
    }
    if (ch === ";") {
      flush(";");
      i++;
      continue;
    }
    if (ch === "&") {
      flush("&");
      i++;
      continue;
    }
    if (ch === "|") {
      flush("|");
      i++;
      continue;
    }
    if (ch === "`") {
      flush("`");
      i++;
      continue;
    }
    if (ch === "(") {
      flush("(");
      i++;
      continue;
    }
    if (ch === ")") {
      flush(")");
      i++;
      continue;
    }
    if (ch === "$") {
      flush("$");
      i++;
      continue;
    }
    if (ch === "\n") {
      flush("\n");
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(command[j]) && !/[;&|`$()\n]/.test(command[j])) j++;
    cur.push(command.slice(i, j));
    i = j;
  }
  flush();
  return tokens;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1);
  }
  return s;
}

function isRecursiveFlag(p: string): boolean {
  if (p === "-r" || p === "-R" || p === "--recursive") return true;
  // combined short flags containing r/R (e.g. -rn); -e/-E are regex flags
  return /^-[A-Za-z]+$/.test(p) && p.length > 1 && /[rR]/.test(p) && !/^-[Ee]/.test(p);
}

function analyze(command: string): string | null {
  const tokens = tokenize(command);
  const cmdIdx = tokens
    .map((t, i) => (t.type === "cmd" ? i : -1))
    .filter((i) => i >= 0);

  for (const idx of cmdIdx) {
    const parts = tokens[idx].text.split(/\s+/);
    const head = parts[0].replace(/^.*\//, ""); // strip path: /usr/bin/find → find

    // find with an absolute path walks a wide tree
    if (head === "find" && parts.length >= 2 && parts[1].startsWith("/")) {
      const path = parts[1];
      const nameI = parts.findIndex((p) => p === "-name" || p === "-iname");
      const pattern = nameI > 0 ? unquote(parts[nameI + 1]) : null;
      const hint = pattern
        ? `locate ${pattern}   # answers in ~ms from the locate index\n` +
          `locate ${pattern} -b | grep '/$'   # if you need directories`
        : `locate <pattern>   # answers in ~ms from the locate index`;
      return (
        `Blocked: raw \`find ${path} ...\` walks a large tree and takes minutes. ` +
        `Use locate instead:\n${hint}\n` +
        `(If the file may be newer than the last index, run: sudo updatedb. ` +
        `For scoped searches inside a repo, use the built-in find tool or \`fd\`. )`
      );
    }

    // grep -r → rg
    if (head === "grep" && parts.some((p, i) => i > 0 && isRecursiveFlag(p))) {
      return (
        "Blocked: recursive `grep -r` is slow. Use ripgrep instead: " +
        "`rg \"pattern\" [path]` (already on PATH, respects .gitignore)."
      );
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = event.input.command ?? "";
    if (!command) return;

    const reason = analyze(command);
    if (reason) {
      return { block: true, reason };
    }
  });
}
