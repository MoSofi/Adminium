# @adminium/add-on-contracts

## 0.2.11

### Patch Changes

- b847dfc: **An add-on can own a page in the dashboard, and a row in the sidebar for it.**
  
  Until now an add-on could fill a slot inside somebody else's screen, and nothing
  more: the manifest schema refused `pages` outright, and the five sidebar groups
  were a closed set written out in five places. So a feature large enough to need
  its own screen had to be built into Adminium itself, whatever the plan said.
  
  An add-on's manifest may now declare `pages` — each one a module in its own
  bundle, with a title, an icon and where it belongs in the rail — and
  `navGroups`, if it would rather bring a group of its own than join one. A page
  that names no group lands in **Library**. Several pages of one add-on can sit
  together under a heading the add-on brought with it, and that heading carries
  its own label, so nothing in the engine has to know the words.
  
  The page itself runs as a page, not as an iframe with a border: the dashboard
  publishes its React, its UI kit, its router, its query client, its translations
  and its own helpers to the bundle, so the add-on renders inside the shell with
  one React, one cache and one history. The module is served over an
  authenticated route and pinned to the fingerprint recorded when the add-on was
  installed — a package edited on disk afterwards is refused rather than run.
  
  Every way this can fail says which one it is. Not installed, switched off, no
  page at that address, the package does not ship the file it names, the module
  would not load, the page itself threw: six sentences, six different answers, and
  a blank screen is not one of them.

## 0.2.10

### Patch Changes

- d95d39f: **Projects: pages and widgets written in React.**
  
  - **Pages.** A project's `pages/<address>.tsx` (`export default definePage({ title, icon, nav,
    component })`) is a page at `/p/<address>`, with a place in the sidebar and the same view grants
    as any page. The server keeps a page row for it (origin `project`); Studio lists it as project
    code and refuses to edit it. A page file and a React page cannot share an address.
  - **Widgets.** `widgets/<name>.tsx` (`defineWidget({ kind: 'cell' | 'card', component })`) is
    `project.<name>`: a page file names it on a table column (`"widget"`) or a dashboard layout item.
    A cell that cannot be drawn shows the plain value with a warning mark; a card that does not load
    shows the widget error state. `adminium check` fails on a widget name that does not exist, or a
    card where a cell goes.
  - **The UI kit**, `@adminiumjs/adminium/ui`: `Page`, `Card`, `Stack`, `Grid`, `Button`, `Input`,
    `Select`, `Switch`, `DataTable`, `Stat`, `EmptyState`, `Icon`, `Link`, `GeneratedPage`, `toast`,
    and the hooks `useRecords`, `useRecord`, `useMutation`, `useCurrentUser` and `useNavigate`. They
    are the dashboard's own components, and the data hooks go through the data API as the person
    looking.
  - **One React.** The dashboard publishes its React, JSX runtime, `react-dom` and the kit on
    `globalThis.__ADMINIUM_ADD_ON_RUNTIME__` (`@adminium/add-on-contracts/runtime`), and a project's
    bundles read them from there, so hooks and context work across project code and the kit.
  - **Build and serve.** `adminium build` bundles pages and widgets for the browser into
    `.adminium/build/client/`, with hashed file names; the server serves them to signed-in people at
    `GET /api/v1/project/client/*`, checks each file against the build before sending it, and lists
    them in `GET /api/v1/bootstrap` (`project.client`) with their integrity. `adminium dev` rebuilds
    them on save, and open dashboards load the new files.
  - **Studio → Settings → Project** lists the project's pages and widgets.
  - **Dashboard:** a page template whose code does not load shows the error card with a Retry
    instead of a skeleton that never ends. The built-in template loaders are a chunk of their own,
    which takes 2.1 KiB gz off the first load. What the dashboard says about a project's code is a
    new, lazily loaded `project` message namespace.
  - **`@adminium/widgets`:** table columns take a `widget`, drawn through `CustomCellProvider`; a
    host app's own card widgets resolve through `ExternalWidgetsProvider`, after the registry.
  - **The project Dockerfile** copies the whole project folder, without `node_modules`, so `start`
    can tell the build is current.

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

### Patch Changes

- ab6314e: `describeShippingCarrier` names the inbound direction: quote is
  direction-symmetric — the same route reversed still quotes — and the refusal is
  end-symmetric, so a carrier that would refuse an address as a recipient refuses it
  as a sender. No interface member changes shape; a return is the same contract with
  the route reversed, and the suite now says so executably.
- 8fb86bf: The contract registry gains a fourth entry: `document-render@1` (bought
  2026-09-02), with two implementations in the same wave — `invoices` and `barcode-labels`
  — which is what gate asks of a new contract.
  
  It is the first contract an add-on uses to hand Adminium **bytes**. Every other
  one describes a conversation with a service: a carrier quotes and books, a
  personalizer prices an option, a transport delivers a message. This one takes a
  `DocumentSubject` — values only, no database handle, no connection, no clock —
  and returns rendered files. The subject is the only door, and it is frozen into
  the register row at render time, so a document stays what it was after the row
  it was drawn from is edited or deleted.
  
  What the conformance suite (`describeDocumentRenderer`) holds an implementer to:
  
  - every kind it names must `describe()`, with `label` and `help` as **records in
    all eight compiled locales** — never a key. There is no add-on bundle in the
    dashboard to resolve one against, so a `{key, fallback}` label would ship its
    English fallback to eight languages.
  - rendering the same subject twice is **byte-identical**. A renderer that stamps
    a clock or a random id fails here rather than on somebody's invoice.
  - money arrives as **integer minor units** and percentages as **basis points**;
    the arithmetic law itself belongs to the implementer, not the contract.
  - HTML output carries no `<script>`; PDF output is `%PDF-1.4` with a byte-exact
    xref table, asserted by parsing it back over a subject containing `é ß ø €` —
    and a kind declaring `coverage: 'ascii'` must REFUSE those glyphs rather than
    drop them silently.
  - a locale the implementer cannot draw refuses with `LATIN_ONLY` and names what
    it `dropped`; a missing required slot refuses `MISSING_SLOT`; an unknown kind
    refuses `UNSUPPORTED_KIND`.
  
  `@adminium/manifest` moves with it: an add-on may now declare
  `provides: [{contract: 'document-render', version: 1}]` and be installed, a
  setting may carry `help` beside its `label`, and `dashboard` joins the reserved
  key set — it is the host an add-on attaching to `*` is mounted under on a
  deployment with no host app, so an app of that name would make the attachment
  ambiguous.
  
  **No new slots.** `document-render@1` is drawn through the two ids that already
  existed, `record.actions` and `settings.add-on.panel`.
- ce438a0: The closed slot registry gains a thirteenth id: `shell.overlay` (bought
  2026-09-01). Surface `customer`, fill `multi`, payload `ShellOverlayPayload`.
  
  It is the first slot on a **customer shell** rather than inside one of its
  flows. Every other customer id in the registry is a place inside something — a
  product being configured, a basket line, a checkout's delivery step, a dispatch
  being read. This one is the layer above the page: a floating affordance a
  visitor can reach from any screen, and the panel it opens.
  
  Its dossier is FOUR exhibits where `record.actions` had seven, and one of the
  four is an absence — ten customer-side apps with no way to reach the operator
  from the shell. The entry says so in those words rather than dressing four up
  as enough. What it has that the twelfth did not is the condition the registry's
  own header sets: it ships **with** its fill, `live-chat`, in the same wave, so
  "a slot nobody fills is a guess" is satisfied on the day the id lands instead of
  being owed to a later one.
  
  No existing id, surface, fill rule or payload changes. A manifest that names
  `shell.overlay` needs this release plus a refreshed lockfile before it
  validates — that ordering is deliberate, and a manifest test going red in
  between is the mechanism working.

## 0.2.5

## 0.2.4

## 0.2.3

### Patch Changes

- 78cf75f: The closed slot registry gains a twelfth id, `record.actions` — one opening on
  the screen where somebody is already looking at ONE record, to do a thing to it.
  `surface: 'both'`, `fill: 'multi'`, payload "what kind of record it is, the
  record, and a way to write back".
  
  **Patch and not minor, deliberately.** The `fixed: [["@adminium/*"]]` group
  forces the highest pending bump onto all twenty workspaces, so a `minor` here
  would promote the whole monorepo for a change that adds one entry to one array.
  Nothing that exists stops working: the registry is additive, `SlotId` widens,
  and every consumer that enumerated eleven ids still enumerates eleven of the
  twelve.
  
  It arrives with **no fill anywhere**, which is worth stating in a changelog
  rather than leaving a reader to discover. The registry has refused an unfilled
  slot before, on the grounds that one nobody fills is a guess about a future
  add-on. This one is not a guess: it carries seven exhibits with a file and a
  line each, gathered by five independent surveys of the fifteen example apps and
  held to an adversarial pass, and the entry itself sets out the difference at
  length. Its first consumer is a paperwork add-on that has not been built yet.
  
  Consumers who mirror the registry — every example app vendors a copy at
  `src/testing/manifest/slots.ts` — pick this up by re-running
  `scripts/sync-manifest-validator.mjs`, not by hand.

## 0.2.2

## 0.2.2-rc.0

## 0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
