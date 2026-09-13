/**
 * Minimal tests for trash-guard. Run with: npx tsx test-trash-guard.ts
 * No external deps beyond what the extension itself imports (plus jiti).
 */
import assert from "node:assert";
import { createJiti } from "jiti";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function loadHandler(extensionPath: string) {
  const dir = mkdtempSync(join(tmpdir(), "tg-test-"));
  const src = readFileSync(extensionPath, "utf8")
    .replace(/import type.*ExtensionContext.*\n/, "")
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
  return async (cmd: string, ctx: any = { ui: { confirm: async () => true } }) => {
    const input = { command: cmd };
    const res = await handler!({ toolName: "bash", input }, ctx);
    return { blocked: !!(res && res.block), reason: res?.reason ?? null, command: input.command };
  };
}

async function main() {
  const run = loadHandler(new URL("../index.ts", import.meta.url).pathname);

  const cases: Array<[string, boolean, string | null, boolean]> = [
    // [command, expectBlocked, expectedCommand (null = unchanged), expectConfirmShown]
    ["rm foo.txt", false, "trash-put foo.txt", false],
    ["rm -f foo.txt", false, "trash-put -f foo.txt", false],
    ["rm -rf node_modules", false, "trash-put -f node_modules", false],
    ["rm -rf ./build/dist", false, "trash-put -f ./build/dist", false],
    ["rm -r -f ./tmp", false, "trash-put -f ./tmp", false],
    ["rm -irf ./logs", false, "trash-put -if ./logs", false],
    ["rm -R foo", false, "trash-put foo", false],
    ["rm --recursive foo", false, "trash-put foo", false],
    ["rm /etc/hosts", false, "trash-put /etc/hosts", true],
    ["rm -rf /home/user/models/x", false, "trash-put -f /home/user/models/x", true],
    ["rm -rf /", false, "trash-put -f /", true],
    ["rm -f .gitignore && echo done", false, "trash-put -f .gitignore && echo done", false],
    ["echo rm -rf / not a command", false, null, false],
    ["shred -u secret.key", true, null, null],
    ["srm -p password.txt", true, null, null],
    ["trash-empty", false, null, true],
    ["trash-put foo.txt", false, null, false],
    ["trash-list", false, null, false],
    ["rm", false, null, false],
    ["rm -- foo", false, "trash-put -- foo", false],
    ['find . -name "*.tmp" -delete', false, null, false],
    ["git rm foo.txt", false, null, false],
    ["rm -rf /tmp/scratch; ls", false, "trash-put -f /tmp/scratch ; ls", true],
    ['rm "my file.txt"', false, 'trash-put "my file.txt"', false],
    ["rm -v foo", false, "trash-put foo", false],
    ["rm -fr ./a ./b", false, "trash-put -f ./a ./b", false],
    ["ls; rm -rf /x", false, "ls ; trash-put -f /x", true],
    ['rm -rf "$(pwd)/junk"', false, 'trash-put -f "$(pwd)/junk"', false],
  ];

  let failed = 0;

  let confirms = 0;
  const countingCtx = { ui: { confirm: async () => { confirms++; return true; } } };

  for (const [cmd, expBlock, expCmd, expConfirm] of cases) {
    confirms = 0;
    const r = await run(cmd, countingCtx);
    const cmdOk = expCmd === null ? r.command === cmd : r.command === expCmd;
    const confirmOk = expConfirm === null ? true : confirms > 0 === expConfirm;
    try {
      assert.strictEqual(r.blocked, expBlock, "blocked mismatch");
      assert.ok(cmdOk, `command mismatch: ${r.command}`);
      assert.ok(confirmOk, `confirm mismatch: shown=${confirms > 0}`);
      console.log(`PASS  ${cmd}`);
    } catch (e: any) {
      failed++;
      console.log(`FAIL  ${cmd}\n      got: blocked=${r.blocked} cmd=${JSON.stringify(r.command)} confirm=${confirms > 0}\n      ${e.message}`);
    }
  }

  // headless (no UI): confirm-required path must block
  const h = await run("rm -rf /home/user/x", {});
  assert.ok(h.blocked, "headless absolute-path rm should block");
  console.log("PASS  headless (no UI) blocks absolute-path rm");

  // declining the confirm must block
  const d = await run("rm -rf /etc/foo", { ui: { confirm: async () => false } });
  assert.ok(d.blocked, "declined confirm should block");
  console.log("PASS  declined confirmation blocks");

  console.log(failed === 0 ? `\nAll ${cases.length + 2} tests passed.` : `\n${failed} tests FAILED.`);
  process.exit(failed ? 1 : 0);

}

main();