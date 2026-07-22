/**
 * Vendors unmodified upstream woff2 builds from the @fontsource packages in node_modules
 * into src/fonts/, where they are served via the "./fonts/*" export and referenced by
 * src/fonts.css. Runs as the first step of `pnpm build` (before tsc).
 *
 * - Idempotent: re-runs skip files that are already present with identical size.
 * - Graceful: if node_modules isn't installed yet, warns and exits 0 so the build
 *   pipeline can proceed (fonts are committed, so a missing copy is non-fatal).
 * - Never subsets or re-encodes: "Plex" is an OFL Reserved Font Name; modified builds
 *   would require renaming the font. See 02-design-system.md §2.4.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Font files vendored from node_modules, keyed by source package. */
export const FONT_MANIFEST = [
  {
    pkg: "@fontsource-variable/manrope",
    dest: "manrope",
    files: [
      "manrope-latin-wght-normal.woff2",
      "manrope-latin-ext-wght-normal.woff2",
    ],
  },
  {
    pkg: "@fontsource-variable/jetbrains-mono",
    dest: "jetbrains-mono",
    files: [
      "jetbrains-mono-latin-wght-normal.woff2",
      "jetbrains-mono-latin-ext-wght-normal.woff2",
      "jetbrains-mono-latin-wght-italic.woff2",
      "jetbrains-mono-latin-ext-wght-italic.woff2",
    ],
  },
  {
    pkg: "@fontsource/ibm-plex-sans-arabic",
    dest: "ibm-plex-sans-arabic",
    files: [
      "ibm-plex-sans-arabic-arabic-400-normal.woff2",
      "ibm-plex-sans-arabic-arabic-500-normal.woff2",
      "ibm-plex-sans-arabic-arabic-600-normal.woff2",
      "ibm-plex-sans-arabic-arabic-700-normal.woff2",
    ],
  },
];

/**
 * Copies manifest fonts from `nodeModulesDir` into `destDir`.
 * Returns { copied, skipped, missingPackages, missingFiles } without throwing.
 */
export function copyFonts(
  nodeModulesDir = path.join(packageRoot, "node_modules"),
  destDir = path.join(packageRoot, "src", "fonts"),
) {
  const result = { copied: 0, skipped: 0, missingPackages: [], missingFiles: [] };

  for (const entry of FONT_MANIFEST) {
    const filesDir = path.join(nodeModulesDir, entry.pkg, "files");
    if (!existsSync(filesDir)) {
      result.missingPackages.push(entry.pkg);
      continue;
    }
    const targetDir = path.join(destDir, entry.dest);
    mkdirSync(targetDir, { recursive: true });

    for (const file of entry.files) {
      const src = path.join(filesDir, file);
      if (!existsSync(src)) {
        result.missingFiles.push(`${entry.pkg}/files/${file}`);
        continue;
      }
      const dest = path.join(targetDir, file);
      if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
        result.skipped += 1;
        continue;
      }
      copyFileSync(src, dest);
      result.copied += 1;
    }
  }
  return result;
}

function main() {
  const { copied, skipped, missingPackages, missingFiles } = copyFonts();

  if (missingPackages.length > 0) {
    console.warn(
      `[copy-fonts] warning: not installed in node_modules: ${missingPackages.join(", ")}. ` +
        "Skipping font vendoring — run `pnpm install` and rebuild to refresh src/fonts/.",
    );
  }
  if (missingFiles.length > 0) {
    console.warn(
      `[copy-fonts] warning: expected files missing from installed packages (version mismatch?): ${missingFiles.join(", ")}`,
    );
  }
  console.log(`[copy-fonts] ${copied} copied, ${skipped} already up to date.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
