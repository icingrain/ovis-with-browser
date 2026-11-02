/**
 * Builds the npm package `ovis-with-browser` into dist-npm/: the ovis-browser helper, the skill installer
 * and the setup command, with only the files they need. The Ovis server itself stays a herdr plugin.
 *
 *   bun scripts/build-npm-package.ts            build dist-npm/
 *   cd dist-npm && npm pack --dry-run           see what would be published (publishing is a separate, manual step)
 */
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(import.meta.filename), "..");
const out = join(root, "dist-npm");
/** the package's own version, apart from Ovis's: it moves when the helper, the skill or the setup command changes */
export const PACKAGE_VERSION = "0.1.0";
/** the Ovis release this fork's Browser tab was last rebased onto and tested with */
export const OVIS_TESTED = "0.4.22";
const FILES = [
  "scripts/ovis-browser.ts",
  "scripts/install-browser-skill.ts",
  "scripts/ovis-with-browser.ts",
  "scripts/ovis-tailnet.ts",
  "scripts/with-bun.sh",
  "scripts/bun-path.sh",
  "integrations/ovis-browser-skill.md",
  "LICENSE",
];

export function packageJson(version: string, ovisTested: string) {
  return {
    name: "ovis-with-browser",
    version,
    description: "Set up the Ovis Browser tab: the ovis-browser helper, its agent skill and a tailnet address",
    license: "MIT",
    type: "module",
    bin: { "ovis-browser": "scripts/ovis-browser.ts", "ovis-with-browser": "scripts/ovis-with-browser.ts" },
    files: [...FILES, "README.md"],
    engines: { bun: ">=1.1" },
    ovisWithBrowser: { ovisTested },
    repository: { type: "git", url: "git+https://github.com/icingrain/ovis-with-browser.git" },
    keywords: ["ovis", "herdr", "browser", "agent-skill"],
  };
}

const README = `# ovis-with-browser

Setup for the Browser tab of [Ovis with Browser](https://github.com/icingrain/ovis-with-browser): the agent's Chrome, live in Ovis.

Needs [Bun](https://bun.sh), herdr and the Ovis with Browser plugin (\`herdr plugin link\` from its repository).

\`\`\`bash
bun add -g ovis-with-browser      # installs the ovis-browser helper and the setup command
ovis-with-browser setup           # asks: install the skill? which tailnet address?
\`\`\`

Without a terminal, or to skip the questions:

\`\`\`bash
ovis-with-browser setup --skill --tailnet separate        # skill, plus a separate tailnet address (8443)
ovis-with-browser setup --no-skill --tailnet existing     # the address already in use (port 443)
\`\`\`

Version ${PACKAGE_VERSION} was tested with Ovis ${OVIS_TESTED} (the release this fork is rebased onto). Windows is not tested yet.
`;

if (import.meta.main) {
  const version = PACKAGE_VERSION;
  rmSync(out, { recursive: true, force: true });
  for (const file of FILES) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    copyFileSync(join(root, file), join(out, file));
  }
  for (const bin of ["scripts/ovis-browser.ts", "scripts/ovis-with-browser.ts"]) chmodSync(join(out, bin), 0o755);
  writeFileSync(join(out, "package.json"), `${JSON.stringify(packageJson(version, OVIS_TESTED), null, 2)}\n`);
  writeFileSync(join(out, "README.md"), README);
  console.log(`Built ${out} (version ${version}).`);
}
