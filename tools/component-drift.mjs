#!/usr/bin/env node
/**
 * Fail when a component that is supposed to be one component is two.
 *
 * A handful of files are duplicated across the three Next apps on purpose:
 * `@ciao/shared` is imported by the API as well, so it cannot hold JSX, and
 * these are the pieces where two apps disagreeing would be a real defect
 * rather than a cosmetic one.
 *
 *   logo.tsx        Three copies of a logo is exactly how a brand ends up with
 *                   three logos, and nobody notices until a partner screenshots
 *                   the wrong one.
 *   brand-band.tsx  The composer in Ciao Business exists to show an operator
 *                   what she is about to publish. A preview that renders
 *                   approximately the marketplace is worse than no preview,
 *                   because it will be trusted.
 *
 * Run it directly, or let the pretest hook run it:
 *
 *     node tools/component-drift.mjs
 *
 * When it fails, the marketplace copy is the canonical one — it is the app the
 * component exists to serve — so copy that file over the others rather than
 * merging by hand.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** canonical → the copies that must match it byte for byte. */
const TWINS = [
  {
    canonical: "apps/web/src/components/logo.tsx",
    copies: ["apps/partner/src/components/logo.tsx", "apps/console/src/components/logo.tsx"],
  },
  {
    canonical: "apps/web/src/components/brand-band.tsx",
    /*
     * Not the partner app. A host has no business seeing the marketplace's
     * marketing furniture in their own console, so the file simply does not
     * exist there — and listing it here would demand that it did.
     */
    copies: ["apps/console/src/components/brand-band.tsx"],
  },
];

let drifted = 0;
for (const { canonical, copies } of TWINS) {
  const src = join(ROOT, canonical);
  if (!existsSync(src)) {
    console.error(`missing canonical file: ${canonical}`);
    drifted++;
    continue;
  }
  const want = readFileSync(src, "utf8");
  for (const copy of copies) {
    const path = join(ROOT, copy);
    if (!existsSync(path)) {
      console.error(`missing copy: ${copy}`);
      drifted++;
      continue;
    }
    if (readFileSync(path, "utf8") !== want) {
      console.error(`drift: ${copy} differs from ${canonical}`);
      console.error(`       cp ${relative(process.cwd(), src)} ${relative(process.cwd(), path)}`);
      drifted++;
    }
  }
}

if (drifted) {
  console.error(`\n${drifted} file(s) drifted. See the header of this script for why it matters.`);
  process.exit(1);
}
console.log(`component-drift: ${TWINS.length} component(s) in sync.`);
