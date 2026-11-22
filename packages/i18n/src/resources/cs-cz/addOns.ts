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
    "body": "Stránka, kterou jste otevřeli, patří add-onu, který na tomto serveru není nainstalovaný nebo byl vypnutý. Správce jej může nainstalovat ve Studiu."
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
  "refused": {
    "body": "Kód stránky se načetl, ale server odmítl jeden z jejích požadavků: {reason}"
  },
  "crashed": {
    "body": "Kód stránky se načetl, ale zastavil se s chybou: {reason}"
  },
  "listFailed": {
    "body": "Seznam nainstalovaných add-onů se nepodařilo načíst, takže nelze určit, který soubor má tato stránka načíst."
  },
  "tooOld": {
    "title": "Tato stránka potřebuje novější Adminium",
    "body": "Stránka tohoto doplňku byla vytvořena pro novější verzi Adminia, než je tato. Otevře ji aktualizace Adminia; nic ze stránky nebylo spuštěno."
  },
  "accounts": {
    "notice": {
      "connectedTitle": "{person} připojil(a) účet",
      "connectedBody": "{person} je teď připojen(a) ke službě {provider} jako {account}.",
      "refusedTitle": "{provider} odmítl aplikaci tohoto serveru",
      "refusedBody": "Zkontrolujte ID klienta a tajný klíč uložené pro {provider}. Nikdo se nemusí znovu připojovat: připojení se obnoví, jakmile bude aplikace přijata.",
      "clashTitle": "{person} má v kalendáři kolizi",
      "clashBody": "Obsazený čas v kalendáři osoby {person} se teď překrývá s rezervací. Otevřete rezervaci a přesuňte ji, nebo ji ponechte.",
      "staleTitle": "Obsazené časy osoby {person} byly odebrány",
      "staleBody": "{person} se 7 dní znovu nepřipojil(a), takže tento kalendář už neblokuje časy.",
      "removedTitle": "{person} odstranil(a) kalendář {calendar}",
      "removedBody": "Byl smazán dvakrát během týdne, takže rezervace už do kalendáře osoby {person} nechodí, dokud je znovu nezapne.",
      "remadeTitle": "Kalendář {calendar} byl vytvořen znovu",
      "remadeBody": "Byl smazán z účtu osoby {person}, takže byl vytvořen znovu s nadcházejícími rezervacemi.",
      "silentTitle": "Změny z kalendáře osoby {person} přicházejí opožděně",
      "silentBody": "Okamžité aktualizace se zastavily, takže změny přicházejí s pravidelnou kontrolou, přibližně do 12 minut.",
      "secretEndingTitle": "Tajný klíč klienta {provider} končí {date}",
      "secretEndingBody": "Před tímto dnem vytvořte nový tajný klíč a vložte ho do průvodce nastavením, jinak se všechna připojení k {provider} zastaví. Nikdo se nemusí znovu připojovat.",
      "unreadableTitle": "Jeden kalendář osoby {person} už nelze číst",
      "unreadableBody": "Byl smazán nebo už není sdílený, proto byl odebrán z kalendářů počítaných jako obsazené a už neblokuje časy osoby {person}. Ostatní kalendáře je blokují dál.",
      "namesLeftTitle": "V kalendáři uživatele {person} může být stále vidět jméno zákazníka",
      "namesLeftBody": "Některé události v kalendáři {calendar} se nepodařilo odstranit před ukončením tohoto připojení. Požádejte uživatele {person} o jejich smazání."
    }
  }
} as const;
