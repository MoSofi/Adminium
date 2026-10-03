// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/designer.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "brand": "Adminium Designer",
  "spent": {
    "title": "Dette link er allerede brugt",
    "body": "Kør design-kommandoen igen for at åbne Adminium Designer.",
    "copy": "Kopiér kommandoen",
    "copied": "Kopieret"
  },
  "topbar": {
    "home": "Forside for Adminium Designer",
    "toDark": "Skift til mørkt tema",
    "toLight": "Skift til lyst tema",
    "dashboard": "Åbn dashboardet",
    "language": "Sprog"
  },
  "home": {
    "title": "Hvad vil du bygge?",
    "lead": "Beskriv det. Adminium leverer databasen, dashboardet, login og API’et.",
    "promptLabel": "Beskriv din app",
    "placeholder": "Beskriv din app…",
    "placeholderNoModel": "Tilføj en model for at begynde",
    "send": "Send",
    "noModel": "Adminium Designer bruger din egen AI-model. Tilføj en for at begynde.",
    "cannotBuild": "Denne model kan ikke bygge apps: den understøtter ikke værktøjer. Vælg en anden model.",
    "failed": "Designeren kunne ikke starte"
  },
  "target": {
    "label": "Hvad der skal bygges: {target}",
    "menu": "Hvad der skal bygges",
    "auto": "Auto",
    "autoLine": "Adminium bestemmer",
    "dashboard": "Kun dashboard",
    "dashboardLine": "tabeller og administrationssider",
    "web": "Web",
    "webLine": "en medarbejder- eller kundeside"
  },
  "examples": {
    "label": "Eksempler",
    "refresh": "Vis andre eksempler",
    "repair": {
      "label": "Reparationsværksted",
      "text": "Et reparationsværksted: kunder afleverer en ting, personalet registrerer opgaven og delene, og kunden får besked, når den er klar til afhentning."
    },
    "classes": {
      "label": "Holdtilmeldinger",
      "text": "Holdtilmeldinger til et lille studie: et ugeskema, pladser pr. hold, en venteliste og en påmindelse dagen før."
    },
    "loans": {
      "label": "Udlån af udstyr",
      "text": "Udlån af udstyr til et team: hvem har hvilken ting, hvornår den skal afleveres, og en påmindelse, når den er forsinket."
    },
    "catering": {
      "label": "Cateringordrer",
      "text": "Cateringordrer: kunder vælger en menu og en dato, personalet bekræfter, og køkkenet kan se, hvad der skal laves hver dag."
    },
    "volunteers": {
      "label": "Frivilligvagtplan",
      "text": "En frivilligvagtplan til et fælleskøkken: vagter hver uge, hvem der har meldt sig til hvilke, og en liste over de ledige vagter."
    },
    "nursery": {
      "label": "Planteskolens lager",
      "text": "Lager til en planteskole: planter, deres størrelser og priser, hvor mange der står på hvert bord, og hvad der skal omplantes denne uge."
    },
    "grooming": {
      "label": "Hundefrisør",
      "text": "Bookinger hos en hundefrisør: ejere booker en tid online til deres hund, personalet ser dagen, og hvert besøg gemmer sine noter."
    },
    "tutoring": {
      "label": "Lektiehjælp",
      "text": "Lektiehjælp: elever, undervisere og fag, de timer der er booket hver uge, og hvad der blev gennemgået i hver."
    },
    "bikes": {
      "label": "Cykeludlejning",
      "text": "Cykeludlejning: cyklerne og deres stand, udlejning pr. time eller dag, og hvilke cykler der er ude lige nu."
    },
    "lost": {
      "label": "Hittegods",
      "text": "Et hittegodskontor: indleverede ting med sted og tidspunkt og en offentlig side, hvor folk kan beskrive, hvad de har mistet."
    },
    "foodbank": {
      "label": "Afhentning i fødevarebanken",
      "text": "Afhentning i fødevarebanken: husstande tilmelder sig, booker et afhentningstidspunkt, og personalet markerer hver pakke som udleveret."
    },
    "rooms": {
      "label": "Lokalebooking",
      "text": "Lokalebooking til et delt studie: lokaler, hvem der har booket hvilket og hvornår, og aldrig to bookinger på samme tid."
    }
  },
  "start": {
    "title": "Start med en app",
    "filters": "Filtrér apps",
    "all": "Alle",
    "browse": "Gennemse alle",
    "loading": "Indlæser applisten",
    "off": "Onlinelisten over apps er slået fra for denne installation.",
    "failed": "Listen over apps kunne ikke indlæses.",
    "stillDescribe": "Du kan stadig beskrive en app ovenfor.",
    "retry": "Prøv igen",
    "startThis": "Start med denne",
    "startApp": "Start med denne: {name}",
    "staffSide": "Medarbejderside",
    "customerSide": "Kundeside"
  },
  "apps": {
    "title": "Dine apps",
    "noVersions": "Ingen versioner endnu",
    "versions": "{count, plural, one {# version} other {# versioner}}",
    "edited": "Redigeret {when}",
    "continue": "Fortsæt",
    "continueApp": "Fortsæt {name}"
  },
  "model": {
    "add": "Tilføj en model",
    "button": "Model: {model}",
    "buttonCannot": "Model: {model}. Den kan ikke bygge apps.",
    "choose": "Vælg en model",
    "fromSettings": "{provider} · gemt i Indstillinger",
    "find": "Find en model",
    "list": "Modeller",
    "empty": "Ingen modeller endnu.",
    "cannotBuild": "Kan ikke bygge",
    "cannotBuildHint": "Denne model understøtter ikke værktøjer, så den kan ikke bygge apps.",
    "unreachable": "Kunne ikke nå denne forbindelse",
    "retry": "Prøv igen",
    "keyRefused": "Nøglen blev afvist.",
    "testFailed": "Testen mislykkedes: {message}",
    "chooseProvider": "Vælg en udbyder",
    "addedChip": "Tilføjet",
    "close": "Luk",
    "address": "Adresse",
    "key": "API-nøgle",
    "optional": "Valgfri",
    "keySaved": "En nøgle er gemt. Skriv en ny for at erstatte den.",
    "showKey": "Vis nøglen",
    "hideKey": "Skjul nøglen",
    "copyKey": "Kopiér nøglen",
    "copied": "Kopieret",
    "model": "Model",
    "testKeyFirst": "Test nøglen for at vise modeller",
    "testAddressFirst": "Test adressen for at vise modeller",
    "connected": "Forbundet. {model} svarede på {seconds} s.",
    "checking": "Spørger modellen, om den kan bygge…",
    "canBuild": "Denne model kan bygge apps.",
    "cannotBuildSave": "Denne model kan ikke bygge apps: den understøtter ikke værktøjer. Du kan stadig gemme den til andre formål.",
    "keptLead": "Hvor det gemmes:",
    "kept": "i filen {file} i din projektmappe, på denne maskine. Den sendes ikke til browseren og committes ikke til git.",
    "back": "Tilbage",
    "test": "Test",
    "testing": "Tester…",
    "save": "Gem",
    "saving": "Gemmer…",
    "addedToast": "Model tilføjet."
  },
  "provider": {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "compatible": "OpenAI-kompatibel",
    "ollama": "Ollama (lokal)",
    "anthropicLine": "Claude-modeller. Kræver en API-nøgle.",
    "openaiLine": "GPT-modeller. Kræver en API-nøgle.",
    "compatibleLine": "Enhver tjeneste, der taler samme protokol. Kræver en adresse.",
    "ollamaLine": "Modeller, der kører på denne maskine. Ingen nøgle."
  },
  "build": {
    "answerFailed": "Svaret blev ikke modtaget",
    "answerPlaceholder": "Besvar spørgsmålet ovenfor…",
    "chat": "Chat",
    "empty": "Beskriv, hvad der skal bygges eller ændres, så går Designeren i gang.",
    "halves": "Chat og forhåndsvisning",
    "home": "Tilbage til Designeren",
    "message": "Besked til Adminium Designer",
    "missing": "Denne session findes ikke her",
    "missingBody": "Den hører måske til en anden projektmappe.",
    "openDashboard": "Åbn i dashboardet",
    "placeholder": "Beskriv en ændring…",
    "preview": "Forhåndsvisning",
    "rename": "Navnet på denne app",
    "renameApp": "Omdøb {name}",
    "resize": "Ændr chattens bredde",
    "saveFailed": "Ændringen blev ikke gemt",
    "stop": "Stop",
    "stopFailed": "Runden kunne ikke stoppes",
    "turnFailed": "Designeren kunne ikke starte denne runde",
    "work": "Appen"
  },
  "card": {
    "addIt": "Tilføj den",
    "doWithout": "Undvær den",
    "keepAll": "Behold dem",
    "keepAsWas": "Behold det, som det var",
    "keepColumn": "Behold kolonnen",
    "keepTable": "Behold tabellen",
    "kept": "Beholdt.",
    "narrow": "Indsnævring af {column} i {table}: {rows, plural, one {# række passer ikke længere} other {# rækker passer ikke længere}}. De bliver under alle omstændigheder.",
    "narrowIt": "Indsnævr den",
    "narrowTitle": "Denne ændring indsnævrer en kolonne",
    "narrowed": "Indsnævret.",
    "noAnswer": "Der blev ikke givet noget svar.",
    "ownWords": "Svar med mine egne ord",
    "package": "Der skal bruges en pakke: {name} ({version}). Tilføj den?",
    "packageNo": "Du valgte at undvære den.",
    "packageYes": "Du sagde ja.",
    "removalTitle": "Denne ændring fjerner data",
    "removeAll": "Fjern dem og deres data",
    "removeColumn": "Hvis kolonnen {column} fjernes fra {table}, slettes det, der er gemt i den: {rows} rækker har en værdi.",
    "removeIt": "Fjern den og dens data",
    "removeTable": "Hvis tabellen {table} fjernes, slettes {rows, plural, one {dens # række} other {dens # rækker}}.",
    "removed": "Fjernet.",
    "youAnswered": "Dit svar: {answer}"
  },
  "step": {
    "addOns": "Ser på tilføjelserne",
    "addOnsDone": "Så på tilføjelserne",
    "answered": "Du svarede",
    "applied": "Anvendt på databasen",
    "applying": "Anvender appen",
    "asking": "Spørger dig",
    "buildFailed": "Skærmene kunne ikke bygges",
    "building": "Bygger skærmene",
    "built": "Byggede skærmene",
    "checkedClean": "Tjekkede appen — ingen fejl",
    "checkedErrors": "{count, plural, one {Tjekkede appen — # fejl} other {Tjekkede appen — # fejl}}",
    "checking": "Tjekker appen",
    "deleted": "Slettede {subject}",
    "deleting": "Sletter {subject}",
    "edited": "Redigerede {subject}",
    "editing": "Redigerer {subject}",
    "failed": "Dette trin mislykkedes",
    "listed": "Viste filerne",
    "listing": "Viser filer",
    "noScreens": "Ingen skærme at bygge",
    "notApplied": "Ikke anvendt",
    "packageAdded": "Tilføjede {subject}",
    "packageAsking": "Beder om at tilføje {subject}",
    "packageDeclined": "Undværede {subject}",
    "packageFailed": "Kunne ikke tilføje {subject}",
    "packageRefused": "Ingen pakke tilføjet",
    "read": "Læste {subject}",
    "reading": "Læser {subject}",
    "stopped": "Stoppet",
    "testing": "Kører appens tests",
    "testsFailed": "Tests mislykkedes",
    "testsPassed": "Tests bestået",
    "writing": "Skriver {subject}",
    "wrote": "Skrev {subject}",
    "wroteMany": "{count, plural, one {Skrev # fil} other {Skrev # filer}}"
  },
  "steps": {
    "count": "{count, plural, one {# trin} other {# trin}}",
    "running": "(kører)",
    "summary": "{count, plural, one {# trin} other {# trin}} · {seconds} s",
    "usage": "Trin {step} · {tokens} tokens indtil nu",
    "working": "Arbejder",
    "seconds": "{seconds} s"
  },
  "turn": {
    "continue": "Fortsæt",
    "continueMessage": "Fortsæt.",
    "failed": "Runden mislykkedes: {message} Intet gik tabt.",
    "keepGoing": "Fortsæt",
    "keepGoingMessage": "Fortsæt.",
    "limitSaved": "Arbejdet indtil nu er gemt som {version}.",
    "limitSessionTokens": "Denne session har nået sin grænse på {value} tokens.",
    "limitSteps": "Denne runde har nået sin grænse på {value} trin.",
    "limitTurnTokens": "Denne runde har nået sin grænse på {value} tokens.",
    "modelFailed": "Modellen holdt op med at svare ({provider}, {status}). Intet gik tabt.",
    "notApplied": "Rundens ændringer blev ikke anvendt: {message}",
    "putBack": "Sæt filerne tilbage",
    "putBackDone": "Filerne er tilbage, som de var.",
    "retry": "Prøv igen",
    "saved": "Gemt som {version}",
    "stopped": "Stoppet. Intet fra denne runde blev gemt som en version."
  },
  "versions": {
    "button": "Version {version}: {name}",
    "cancel": "Annuller",
    "confirm": "Gå tilbage",
    "confirmBody": "Dine filer vender tilbage til {version}. {later} bliver på listen, så du kan gå frem igen. Data, der allerede er i databasen, beholdes.",
    "confirmBodyNone": "Dine filer vender tilbage til {version}. Data, der allerede er i databasen, beholdes.",
    "confirmTitle": "Gå tilbage til {version}?",
    "current": "aktuel",
    "failed": "Filerne kunne ikke sættes tilbage",
    "goBack": "Gå tilbage til denne",
    "goBackTo": "Gå tilbage til {version}: {name}",
    "notApplied": "De blev ikke anvendt. Næste runde fortæller hvorfor.",
    "off": "Versioner er slået fra",
    "offHint": "Versioner kræver git på denne maskine. Installér git, og start Designeren igen.",
    "title": "Versioner",
    "wentBack": "Dine filer er, som de var i {version}."
  },
  "work": {
    "architecture": "Arkitektur",
    "architectureSoon": "Her vises det, hvordan {name} er bygget.",
    "preview": "Forhåndsvisning",
    "previewSoon": "Forhåndsvisningen af {name} vises her."
  }
} as const;
