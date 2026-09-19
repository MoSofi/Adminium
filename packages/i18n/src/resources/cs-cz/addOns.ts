// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "Tento add-on není nainstalovaný",
    "body": "Stránka, kterou jste otevřeli, patří add-onu, který v tomto pracovním prostoru není nainstalovaný nebo byl vypnutý. Správce jej může nainstalovat ve Studiu."
  },
  "unknown": {
    "title": "Taková stránka neexistuje",
    "body": "Tento add-on je nainstalovaný, na této adrese ale žádnou stránku nemá."
  },
  "retry": "Zkusit znovu",
  "noBundle": {
    "title": "Tuto stránku se nepodařilo načíst",
    "body": "Add-on tuto stránku ohlašuje, ale odpovídající soubor nedodává. Pomůže opětovná instalace nebo novější verze."
  },
  "failed": {
    "title": "Tuto stránku se nepodařilo načíst",
    "body": "Kód add-onu se nepodařilo stáhnout, nebo neodpovídal otisku zaznamenanému při instalaci. Nic z něj nebylo spuštěno."
  },
  "listFailed": {
    "body": "Seznam nainstalovaných add-onů se nepodařilo načíst, takže nelze určit, který soubor má tato stránka načíst."
  }
} as const;
