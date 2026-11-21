// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "Dette add-on er ikke installeret",
    "body": "Siden, du fulgte, hører til et add-on, som ikke er installeret på denne server, eller som er slået fra. En administrator kan installere det i Studio."
  },
  "unknown": {
    "title": "Siden findes ikke",
    "body": "Dette add-on er installeret, men det har ingen side på denne adresse."
  },
  "retry": "Prøv igen",
  "noBundle": {
    "title": "Siden kunne ikke indlæses",
    "body": "Add-on'et annoncerer denne side, men leverer ikke den fil, den peger på. En geninstallation eller en nyere version løser det."
  },
  "failed": {
    "title": "Siden kunne ikke indlæses",
    "body": "Add-on'ets kode kunne ikke hentes, eller den svarede ikke til det fingeraftryk, der blev registreret ved installationen. Intet af den er blevet kørt."
  },
  "refused": {
    "body": "Sidens kode blev indlæst, men serveren afviste noget, den bad om: {reason}"
  },
  "crashed": {
    "body": "Sidens kode blev indlæst, men stoppede med en fejl: {reason}"
  },
  "listFailed": {
    "body": "Listen over installerede add-ons kunne ikke læses, så det kan ikke afgøres, hvilken fil denne side skal indlæse."
  },
  "tooOld": {
    "title": "Denne side kræver en nyere Adminium",
    "body": "Denne tilføjelses side er bygget til en nyere version af Adminium end denne. En opdatering af Adminium åbner den; intet fra siden er blevet kørt."
  },
  "accounts": {
    "notice": {
      "connectedTitle": "{person} forbandt en konto",
      "connectedBody": "{person} er nu forbundet til {provider} som {account}.",
      "refusedTitle": "{provider} afviste denne servers app",
      "refusedBody": "Tjek klient-id og hemmelighed gemt for {provider}. Ingen behøver at forbinde igen: Forbindelserne fortsætter, når appen bliver accepteret.",
      "clashTitle": "{person} har en kalenderkonflikt",
      "clashBody": "En optaget tid i {person}s kalender overlapper nu en booking. Åbn bookingen for at flytte eller beholde den.",
      "staleTitle": "{person}s optagede tider blev fjernet",
      "staleBody": "{person} har ikke genforbundet i 7 dage, så kalenderen blokerer ikke længere tider.",
      "removedTitle": "{person} fjernede kalenderen {calendar}",
      "removedBody": "Den blev slettet to gange på en uge, så bookinger går ikke længere til {person}s kalender, før vedkommende slår det til igen.",
      "remadeTitle": "Kalenderen {calendar} blev oprettet igen",
      "remadeBody": "Den blev slettet fra {person}s konto, så den blev oprettet igen med de kommende bookinger.",
      "silentTitle": "Ændringer fra {person}s kalender kommer forsinket",
      "silentBody": "De øjeblikkelige opdateringer er stoppet, så ændringer kommer med den faste kontrol, inden for cirka 12 minutter."
    }
  }
} as const;
