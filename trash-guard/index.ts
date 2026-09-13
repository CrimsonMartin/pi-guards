import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

/**
 * trash-guard: never let an agent irreversibly delete files.
 *
 * - `rm` (any flag form) → rewritten to `trash-put` (trash-cli, on PATH).
 *   Files land in the trash instead of being destroyed; recover with
 *   `trash-list` / `trash-restore`.
 * - `rm` of absolute paths (e.g. `rm -rf /home/...`, `rm -rf /`) →
 *   additionally requires an explicit user confirmation before the
 *   trashed rewrite executes. In headless runs (no UI) this blocks.
 * - `shred`, `srm` → blocked outright (irreversible by design).
 * - `trash-empty` → requires user confirmation (destroys trashed files).
 *
 * Conservative: quote/shell-aware tokenization; only matches exact
 * command-segment positions; anything unrecognized passes through.
 *
 * Install: drop in ~/.pi/agent/extensions/ (global) or .pi/extensions/ (project).
 * Prereq: `apt install trash-cli` (provides trash-put / trash-list / trash-restore).
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

const R_ONLY = /^(?:-[rR][rR]*|--recursive)$/;

function mapFlag(flag: string): string | null {
  if (flag === "--" || flag === "-f" || flag === "--force" || flag === "-i" || flag === "--interactive") {
    return flag;
  }
  // flags that are no-ops for trash-put (it handles recursion itself)
  if (R_ONLY.test(flag) || flag === "-d" || flag === "--dir") {
    return null;
  }
  // combined short flags, e.g. -rf / -fr / -irf → keep f/i only
  if (/^-[a-zA-Z]+$/.test(flag) && flag.length > 2) {
    const kept = [...flag.slice(1)]
      .filter((c) => c === "f" || c === "i")
      .join("");
    return kept ? `-${kept}` : null;
  }
  // unknown long flag
  return null;
}

type Decision =
  | { kind: "block"; reason: string }
  | { kind: "rewrite"; command: string; confirm?: string }
  | { kind: "pass" };

function analyze(command: string): Decision {
  const tokens = tokenize(command);
  const cmdIdx = tokens
    .map((t, i) => (t.type === "cmd" ? i : -1))
    .filter((i) => i >= 0);

  for (let s = 0; s < cmdIdx.length; s++) {
    const parts = tokens[cmdIdx[s]].text.split(/\s+/);
    const head = parts[0].replace(/^.*\//, "");

    // ── rm → trash-put ───────────────────────────────────────────────
    if (head === "rm") {
      const mapped: string[] = ["trash-put"];
      const args: string[] = [];
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p === "--" || p.startsWith("-")) {
          const m = mapFlag(p);
          if (m) mapped.push(m);
          continue;
        }
        if (unquote(p).startsWith("-")) continue; // stray dash arg: leave it
        args.push(p);
      }
      if (args.length === 0) {
        // bare `rm` (or only flags, no targets): let it error naturally
        return { kind: "pass" };
      }
      const absolute = args.filter((a) => unquote(a).startsWith("/"));
      const newTokens = [...tokens];
      newTokens[cmdIdx[s]] = {
        type: "cmd",
        text: [...mapped, ...args].join(" "),
      };
      const rewritten = newTokens.map((t) => t.text).join(" ");

      if (absolute.length > 0) {
        const list = absolute.join(" ");
        const confirm =
          `rm of absolute path(s): ${list}\n\n` +
          `Rewritten to trash-put (recoverable via trash-list / trash-restore).\n` +
          `Allow?`;
        return { kind: "rewrite", command: rewritten, confirm };
      }
      return { kind: "rewrite", command: rewritten };
    }

    // ── shred / srm: irreversible by design ──────────────────────────
    if (head === "shred" || head === "srm") {
      return {
        kind: "block",
        reason: `Blocked: \`${head}\` destroys data irreversibly. Use \`trash-put\` instead (recoverable via trash-list / trash-restore).`,
      };
    }

    // ── trash-empty: destroys trashed files ──────────────────────────
    if (head === "trash-empty") {
      return {
        kind: "rewrite",
        command,
        confirm: "Empty the trash? This permanently deletes all trashed files.",
      };
    }
  }
  return { kind: "pass" };
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = event.input.command ?? "";
    if (!command) return;

    const decision = analyze(command);
    if (decision.kind === "block") {
      return { block: true, reason: decision.reason };
    }
    if (decision.kind === "rewrite") {
      if (decision.confirm) {
        const ui = ctx?.ui as
          | { confirm?: (title: string, message: string) => Promise<boolean> }
          | undefined;
        if (!ui?.confirm) {
          return {
            block: true,
            reason:
              `Blocked: requires interactive confirmation (not available in this run).\n${decision.confirm}`,
          };
        }
        const ok = await ui.confirm("trash-guard", decision.confirm);
        if (!ok) {
          return { block: true, reason: "Blocked by user (trash-guard confirmation declined)." };
        }
      }
      event.input.command = decision.command;
    }
  });
}
