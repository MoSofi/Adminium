// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "Zpět",
    "change": "Změnit…",
    "create": "Vytvořit",
    "creating": "Připravuje se…",
    "failed": "Projekt se nepodařilo vytvořit.",
    "heading": "Vytvořit aplikaci",
    "help": "Adminium tuto složku vytvoří za vás. Je v ní všechno, co k vaší aplikaci patří.",
    "name": "Název",
    "refuse": {
      "badName": "Použijte v názvu aspoň jedno písmeno nebo číslici.",
      "existsWithFiles": "Složka s tímto názvem už existuje a obsahuje soubory. Zvolte jiný název nebo jinou složku.",
      "homeFolder": "Projekt nemůže být přímo ve vaší domovské složce. Vyberte nebo vytvořte složku uvnitř ní.",
      "insideAProject": "Tato složka je uvnitř jiného projektu. Vyberte složku mimo něj.",
      "insideTheApp": "Projekt nemůže být uvnitř samotného Adminia. Vyberte jinou složku.",
      "notAbsolute": "Vyberte složku tlačítkem „Změnit…“.",
      "systemFolder": "Projekt nemůže být ve složce, která patří systému. Vyberte vlastní složku."
    },
    "step": {
      "files": "Připravují se soubory vaší aplikace",
      "packages": "Stahuje se to, z čeho je aplikace postavena",
      "database": "Vytváří se její databáze",
      "opening": "Otevírá se vaše aplikace",
      "slow": "Tohle je napoprvé ten dlouhý krok: na pomalém připojení pár minut. Další aplikace začnou rychleji.",
      "label": "Co se právě děje"
    },
    "warn": {
      "another": "Vybrat jinou složku",
      "anyway": "Přesto použít",
      "dropbox": "Tuto složku synchronizuje Dropbox. Projekty v synchronizovaných složkách fungují špatně: synchronizace může poškodit jejich data.",
      "googledrive": "Tuto složku synchronizuje Google Drive. Projekty v synchronizovaných složkách fungují špatně: synchronizace může poškodit jejich data.",
      "icloud": "Tuto složku synchronizuje iCloud Drive. Projekty v synchronizovaných složkách fungují špatně: synchronizace může poškodit jejich data.",
      "noLinks": "Tento disk neumí uložit odkazy, které balíčky projektu potřebují, takže jejich stažení nejspíš selže.",
      "onedrive": "Tuto složku synchronizuje OneDrive. Projekty v synchronizovaných složkách fungují špatně: synchronizace může poškodit jejich data."
    },
    "where": "Kam ji uložit"
  },
  "start": {
    "choice": {
      "build": {
        "line": "Popište ji a Designer ji na tomto počítači postaví.",
        "title": "Vytvořit aplikaci"
      },
      "connect": {
        "line": "Použít Adminium, které běží na jiném počítači.",
        "title": "Připojit se k jinému Adminiu"
      },
      "db": {
        "line": "Vytvořit obrazovky pro databázi, kterou už máte.",
        "title": "Použít vlastní databázi"
      },
      "open": {
        "line": "Pokračovat s aplikací, která už je ve složce, nebo kterou vám někdo poslal.",
        "title": "Otevřít složku"
      }
    },
    "heading": "Co chcete udělat?",
    "open": {
      "needsPackages": "Balíčky tohoto projektu na tomto počítači ještě nejsou.",
      "notAProject": "Tato složka není projekt Adminia."
    },
    "recent": {
      "alreadyListed": "Tato složka už v seznamu je.",
      "building": "Ve výstavbě",
      "gone": "Tato složka byla přesunuta nebo smazána",
      "heading": "Nedávné projekty",
      "locate": "Najít…",
      "locateTitle": "Kde je teď {name}?",
      "notThatProject": "Tato složka není projekt Adminia.",
      "open": "Otevřít {name}",
      "openDashboard": "Otevřít dashboard",
      "openDashboardOf": "Otevřít dashboard projektu {name}",
      "openDesigner": "Otevřít v Designeru",
      "openDesignerOf": "Otevřít {name} v Designeru",
      "opened": "Otevřeno {when}",
      "remove": "Odebrat",
      "removed": "Odebráno z nedávných projektů",
      "shared": "Sdíleno"
    },
    "welcome": "Vítejte v Adminiu."
  },
  "toast": {
    "dismiss": "Zavřít",
    "region": "Oznámení"
  },
  "trust": {
    "body": "Otevřením se na tomto počítači spustí její kód, s vaším přístupem k vašim souborům. Otevírejte jen složky, které jste vytvořili sami nebo které pocházejí od někoho, komu důvěřujete.",
    "cancel": "Zrušit",
    "changed": "Kód této složky se od posledního otevření změnil.",
    "open": "Otevřít",
    "title": "Otevřít tuto složku?"
  }
} as const;
