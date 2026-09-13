/**
 * Minimal tests for find-guard. Run with: npx tsx test-find-guard.ts
 * (or any TS runner). No external deps beyond what the extension itself imports.
 */
import assert from "node:assert";
import { createJiti } from "jiti";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Load the extension with the pi import stubbed, capture the tool_call handler.
function loadHandler(extensionPath: string) {
  const dir = mkdtempSync(join(tmpdir(), "fg-test-"));
  const src = readFileSync(extensionPath, "utf8")
    .replace(/import type.*ExtensionAPI.*\n/, "")
    .replace(
      /import \{ isToolCallEventType \}.*\n/,
      "const isToolCallEventType = (name, ev) => ev.toolName === name;",
    );
  const file = join(dir, "extension.ts");
  writeFileSync(file, src);
  const mod = createJiti(import.meta.url, { interopDefault: true })(file);
  const fn = mod.default || mod;
  let handler: ((ev: any, ctx: any) => Promise<any>) | undefined;
  const pi = { on: (name: string, h: any) => { if (name === "tool_call") handler = h; } } as unknown as ExtensionAPI;
  fn(pi);
  return async (cmd: string) => {
    const input = { command: cmd };
    const res = await handler!({ toolName: "bash", input }, {});
    return { blocked: !!(res && res.block), reason: res?.reason ?? null, command: input.command };
  };
}

async function main() {
  const run = loadHandler(new URL("../index.ts", import.meta.url).pathname);

  const cases: Array<[string, boolean, boolean]> = [
    // [command, expectBlocked, expectUnchanged]
    ['find / -iname "example.dll" 2>/dev/null | head', true, true],
    ['find / -iname SomeDir -type d 2>/dev/null | head', true, true],
    ['find / -iname "*scratch*" 2>/dev/null | grep -iv "python\\|node_modules" | head', true, true],
    ['find /', true, true],
    ['find /home/user -name "x.txt"', true, true],
    ['find /tmp -name "a.txt" -exec rm {} \\;', true, true],
    ['find /dev -name tty', true, true],
    ['find . -name "*.rs"', false, true],
    ['find ./src -name foo.py', false, true],
    ['grep -r "TODO" .', true, true],
    ['grep -rn "foo" src/', true, true],
    ['grep -R --include="*.ts" "x" .', true, true],
    ['grep -e pattern -r .', true, true],
    ['find . -type d -name node_modules', false, true],
    ['echo find / not a command', false, true],
    ['rg "x" .', false, true],
    ['grep "foo" file.txt', false, true],
    ['sudo find / -name core', false, true],
    ['ls /; find . -name x', false, true],
    ['find . -name "*.rs" | wc -l', false, true],
    ['grep "x" $(find . -name foo)', false, true],
  ];

  let failed = 0;

  for (const [cmd, expBlock, unchanged] of cases) {
    const r = await run(cmd);
    try {
      assert.strictEqual(r.blocked, expBlock, `blocked mismatch`);
      if (unchanged) assert.strictEqual(r.command, cmd, "command was modified");
      console.log(`PASS  ${cmd}`);
    } catch (e: any) {
      failed++;
      console.log(`FAIL  ${cmd}\n      got: blocked=${r.blocked} cmd=${r.command} reason=${JSON.stringify(String(r.reason).slice(0, 120))}\n      ${e.message}`);
    }
  }

  // spot-check the block reason contains a locate suggestion with the pattern
  const s = await run('find / -iname "example.dll"');
  assert.ok(s.blocked && s.reason!.includes("locate example.dll"), "reason should suggest locate with the pattern");
  console.log("PASS  reason contains locate suggestion");

  console.log(failed === 0 ? `\nAll ${cases.length + 1} tests passed.` : `\n${failed} tests FAILED.`);
  process.exit(failed ? 1 : 0);

}

main();