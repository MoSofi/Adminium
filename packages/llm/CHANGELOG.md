# @adminium/llm

## 0.3.23

### Patch Changes

- @adminium/widgets@0.3.23
  - @adminium/engine@0.3.23

## 0.3.22

### Patch Changes

- 1ae61f2: The assistant is on every page of the dashboard, as a panel docked at the end edge. It opens from a bubble in the corner, from the Ask button in a page's header, or with Ctrl/⌘ + . and stays open from page to page and after a reload. A person has one conversation; every question is asked on the page they are on and the thread says which.
  
  On a page that shows a table's rows (a grid, a record, a board, a calendar, a dashboard) it answers questions about the data in words, with the figures. It knows what the page is showing: the search, the sort, the filters, the ticked rows, the open record, so "these" means what is on screen. Under an answer stand the tables it read, a line when only a part of a table was read, and a line when nothing was read. It reads as the signed-in person: a table, a column or a page their role cannot open is not read for them, and personal columns never reach the model. It only reads; it changes no row and no page.
  
  On any other screen it answers about the workspace and says where things are done, with a link, naming only places that person can open. When what was asked for needs an add-on that is not installed, it shows the add-on's card from the catalogue, with the way to it for someone who may install and "ask an administrator" for anyone else.
  
  On the pages that draft documents (email templates, reports, automation rules) the draft is in the panel with the page's own preview and the same locks and confirmation as before. A draft is usable on the page, and for an editor the document, it was made for; anywhere else it is a small card with the way back. The window that opened over those pages is gone.
  
  Settings → AI gains "Test" for the assistant (it checks that the model can follow the assistant's replies, which a connection test does not) and a daily allowance of tokens per person, with today's use. A person over it is told when it starts again. One question at a time per person.
  
  A list can be ordered by a count or a sum over related rows (`order=<alias>` of an `agg=` or `compute=` figure), with rows that have no value last on every engine, up to 20,000 rows under the filters on SQLite and 200,000 on PostgreSQL and MySQL.
  
  Fixes on the way: a conversation's history was sent to the model again with every turn, growing quadratically; a model that answers with its own tool calls gets a second chance instead of a provider error; an automation rule drafted by the assistant is checked against what its author may read.
- e27992a: The assistant can now do things, when the workspace lets it and a person says yes. Settings → AI has four switches: Create, Change, Send, Delete. All four are off on a new install; a workspace that was already in use keeps Create on, so its assistant goes on saving drafts as it did. A new field sets how many changes one confirmation may make (1 to 50).
  
  With a switch on, and only for something the signed-in person could do by hand, the assistant proposes: add, change or delete rows of the page they are on (from a screen with no page of its own, of a table they name), save a draft as a new document, save it over the open one, delete a document, send a campaign to roles. Nothing is written by a proposal. The server first tries it as that person, through the same routes the screens use, and the panel shows a card with exactly what would happen as they read the data: old and new values, what refers to a row that would be deleted, who would get a mail, and what cannot be done and why. One click confirms what is ticked; the page's own undo is offered for its minute. A proposal is confirmed once, is let go when something else is asked or after thirty minutes, and is checked again at the confirm: if a row moved or a switch was turned off meanwhile, nothing is written and the card shows what changed.
  
  The audit log marks an entry that was confirmed through the assistant ("through Milo"), on the row and in its details, and a rule set off by such a change carries the mark on what it writes.
  
  The "Enable actions" switch in the panel is gone: what the assistant may do is the workspace's setting, not a button per visit. Saving a draft and adding a language of one now need Create.
  
  A campaign that is switched off cannot be sent by the assistant, and a send is always a proposal of its own. Personal columns still never reach the model; a change to one is shown to the person as the value they gave.
- d339d27: Automations reach one row further, and say what to write when a value is missing. A rule can name a column of the row its record links to (`customer_id.email`): as an email's recipient, and as a placeholder. A placeholder can carry a backup (`{{first_name|there}}`), written when the value is not there; an email block can be tied to a value (shown only when it is there, with other words in its place for a text or a heading). The email editor draws each placeholder as a chip that asks for its backup, has a Visibility section on every block, and previews the email as a reader with no values is sent it.
  
  An installed add-on can give Automations a step. The add-on's manifest says what the step is called, what a person fills in, and the one row of its own table the step makes (`addOn.steps`); the builder offers it under "From add-ons", and a rule runs it through the same write as "create a record", so the add-on's own rules, mails and events follow. A rule keeps a step whose add-on was removed and says which add-on it lost. A personal column of the record may be read only for an input the add-on itself keeps personal, and is never written to a run's log. A rule that holds such a step is checked again when it is switched on.
  
  An add-on can also say what its tables are, in one line each, and offer questions for its own pages (`addOn.assistant`). The assistant reads the lines when it describes a table and shows the questions on the add-on's pages. An add-on cannot give the assistant a tool, switch anything on, or widen what a person reads.
  
  On Automations the assistant drafts a whole rule: it looks up the live templates, the address columns, the roles and the steps add-ons give before it drafts, and says what it left out. The draft's card is drawn by the builder itself. With a rule open, a change is put into that rule's unsaved draft ("Apply to this rule"), marked, and undone with one click; nothing is saved until the person saves.
  
  Manifests that use the new words need Adminium 0.3.22 or later.
- Updated dependencies [1ae61f2]
  - @adminium/widgets@0.3.22
  - @adminium/engine@0.3.22

## 0.3.21

### Patch Changes

- 44bf77e: A model connection whose address is a name is now called at the address that was checked when the name was resolved, so a name that answers differently a moment later gains nothing. The live Designer writes its kept-disk mark in `apps/` as well as `.adminium/`: a host that keeps one folder and not the other is found at the next start, and the switch goes off and says why. A copy of a published app records the commit it was taken from, and the same version arriving later from another commit is refused.
- @adminium/widgets@0.3.21
  - @adminium/engine@0.3.21

## 0.3.20

### Patch Changes

- Updated dependencies [e663535]
  - @adminium/engine@0.3.20
  - @adminium/widgets@0.3.20

## 0.3.19

### Patch Changes

- Updated dependencies [5cfc90d]
- Updated dependencies [be78bbb]
  - @adminium/engine@0.3.19
  - @adminium/widgets@0.3.19

## 0.3.18

### Patch Changes

- Updated dependencies [ba7049f]
- Updated dependencies [e27492d]
- Updated dependencies [ebf296b]
  - @adminium/widgets@0.3.18
  - @adminium/engine@0.3.18

## 0.3.18-rc.0

### Patch Changes

- Updated dependencies [ba7049f]
- Updated dependencies [e27492d]
- Updated dependencies [ebf296b]
  - @adminium/widgets@0.3.18-rc.0
  - @adminium/engine@0.3.18-rc.0

## 0.3.17

### Patch Changes

- Updated dependencies [5209454]
  - @adminium/widgets@0.3.17
  - @adminium/engine@0.3.17

## 0.3.16

### Patch Changes

- 3392573: Attach a picture or a CSV file to a Designer message: by the clip, a paste or a drop, up to four a message.
  
  - A picture (PNG, JPEG, WebP, GIF; 5 MB) is sent to the model when the model reads pictures. Whether it does is asked of the model, once; when it does not, the box says so before the message is sent.
  - A CSV (10 MB, 20,000 rows) is shown to the model as its columns and first rows. Once the app is applied, a card asks before its rows are loaded into one of the app's tables; the load is the dashboard's own import, so the table's checks hold and Imports keeps the report.
  - What a file is, is read from its bytes; anything else is refused. Files are kept in the session's folder and served back only to the Designer's own page, with headers under which nothing in them can run.
  - The Designer now tells a model when its staff role reads a table and not its personal columns (an email, a phone number): a board on such a table was refused for that role in the preview.
- 6e3832c: The Designer sends less at each step. What a turn no longer needs is cut to a line before each call to the model: a file read before it was changed, the earlier writes of a file written again, a check a later check replaced, reference pages read many steps ago. On the turns measured this takes 20 to 46 % off the conversation sent in a long turn. With Anthropic, the unchanged part of each request is read from its prompt cache, and what the cache read is counted in the tokens shown. A sample check that models misread is reworded to say what to write.
- @adminium/widgets@0.3.16
  - @adminium/engine@0.3.16

## 0.3.15

### Patch Changes

- bb75c32: Adminium Designer: "Start with an app" on its home page. A published app is installed as it is (Studio's own install, opened on that app) or made your own: its source copied into the project under a key and a name you give, renamed wherever the old key was written, and built with the app's own build once you approved the command's exact words (`adminium app approve-build`). And the Designer on a server people reach: off until the operator sets `ADMINIUM_DESIGNER=live` and a Super Admin switches it on in Settings → AI with their password; it has no preview there. The folder check now judges an app's public access as an install does. In a copied app the Designer asks before it changes a file the app's build runs, and it never writes a `build.json`. Switching the live Designer off stops the turn that is running, a wrong password at the switch and every answered card are in the audit log, and on a live server the Designer uses the models the server has. A model provider's redirect is never followed. A copied app's build cannot read a file outside the app's own folder, and is not run while a source file plainly names one; an unchanged copy is not built again, and a copy is taken only from the repositories of publishers Adminium vouches for.
- @adminium/widgets@0.3.15
  - @adminium/engine@0.3.15

## 0.3.14

### Patch Changes

- 100163b: Adminium Designer, tuned on real models. A new app starts bare, named from what was asked. The Designer builds on an add-on's shape from the add-on's own manifest (`build_on_shape`), is sent back to check errors it left and told once about a table nobody can open, asks a model's server again after a passing failure, and asks for a screen's packages at the version this server knows. A turn may use 1,500,000 tokens and a session 15,000,000 (`designer.turnTokens`, `designer.sessionTokens`). A screen that stops with an error when it opens says so in the preview. The app's tests, and any file in `hooks/` or `actions/`, wait for the person's yes; an app's own screens are served only on the preview's address while the Designer runs; a connection test sends a saved key only to the address it was saved for; and the link `adminium design` prints is good for fifteen minutes.
- 7976459: Adminium Designer's model picker and "Add a model" dialog. The picker lists every model by connection, finds one as you type, marks a model that cannot build apps, and says when a connection could not be reached. The dialog adds Anthropic, OpenAI, an OpenAI-compatible service or Ollama: test the key or address, see whether the chosen model can build, and save it to the project's `.env` (the key never comes back to the browser). A model that could not be asked — a refused key, no answer — now fails the test and the start of a session with that reason, instead of being reported as unable to build. The design link opened in a tab already showing the Designer is now taken out of the address and spent.
- 9e34726: A model can now be given to the server by its environment, with nothing saved in Settings → AI: `ADMINIUM_AI_ANTHROPIC_API_KEY`, `ADMINIUM_AI_OPENAI_API_KEY`, `ADMINIUM_AI_COMPATIBLE_BASE_URL` (with `ADMINIUM_AI_COMPATIBLE_API_KEY`), `ADMINIUM_AI_OLLAMA_BASE_URL`, and `ADMINIUM_AI_MODEL` as `<provider>/<model>`. The page assistant and the AI assist use the saved provider when there is one and the environment's model when there is none. In a project folder the same names go in `.env`, and they are the one part of that file the server does not copy into its environment. Every path that calls a model now checks its address first, and calls only a local model when `ADMINIUM_NETWORK_FEATURES` is off. New: `GET /llm/connections` and `GET /llm/connections/:id/models`.
- @adminium/widgets@0.3.14
  - @adminium/engine@0.3.14

## 0.3.13

### Patch Changes

- Updated dependencies [60e321d]
- Updated dependencies [df91e11]
  - @adminium/engine@0.3.13
  - @adminium/widgets@0.3.13

## 0.3.12

### Patch Changes

- @adminium/engine@0.3.12
  - @adminium/widgets@0.3.12

## 0.3.11

### Patch Changes

- b07eb0c: The assistant finishes more of the turns it starts, on a local model above all.
  
  - **Ollama.** Every request states its context window (`num_ctx` 32,768) instead of inheriting Ollama's few thousand tokens, which dropped the start of a long prompt, the instructions, without an error; a chat request may take four minutes rather than one.
  - **Long turns.** A running job keeps its lock fresh while its handler is in flight, so a turn longer than the stale window is no longer claimed a second time mid-run. A turn whose process died is ended as failed instead of reading "running" for ever.
  - **Rounds.** A turn has enough rounds to spend every lookup it is allowed and still answer, and is told when its last round has come, so it writes with what it has.
  - **Tools.** The row and aggregate tools show worked filters and descriptors beside their grammar, take `where` as an object, and name a table by its connection's name in the steps and sources a person reads. The invoice contexts show one real starter in the real format.
  - **Replies.** A reply that ran to its end with unbalanced JSON is repaired as a parse error rather than retried as if it had run out of tokens.
  - **Saving.** A draft saves once: a second save of the same turn answers with the document the first one made, and the button reads "Saved". A result's sheet is drawn flush inside the assistant's card, and the header keeps its chips beside the title.
- Updated dependencies [a63590a]
- Updated dependencies [a63590a]
- Updated dependencies [3e9fc5b]
  - @adminium/widgets@0.3.11
  - @adminium/engine@0.3.11

## 0.3.10

### Patch Changes

- @adminium/engine@0.3.10
  - @adminium/widgets@0.3.10

## 0.3.9

### Patch Changes

- Updated dependencies
  - @adminium/widgets@0.3.9
  - @adminium/engine@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [83bc23e]
- Updated dependencies [56c75af]
  - @adminium/widgets@0.3.8
  - @adminium/engine@0.3.8

## 0.3.7

### Patch Changes

- @adminium/engine@0.3.7
  - @adminium/widgets@0.3.7

## 0.3.6

### Patch Changes

- Updated dependencies [d2abd74]
- Updated dependencies [765bc4f]
- Updated dependencies [f14031f]
  - @adminium/widgets@0.3.6
  - @adminium/engine@0.3.6

## 0.3.5

### Patch Changes

- Updated dependencies [dd1c9c0]
- Updated dependencies [d12f866]
- Updated dependencies [77aba9a]
- Updated dependencies [045e3ab]
  - @adminium/widgets@0.3.5
  - @adminium/engine@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d26196]
- Updated dependencies [4d26196]
  - @adminium/engine@0.3.4
  - @adminium/widgets@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [1e00e94]
- Updated dependencies [22f5722]
  - @adminium/widgets@0.3.3
  - @adminium/engine@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [a038c9a]
- Updated dependencies [e1742aa]
  - @adminium/engine@0.3.2
  - @adminium/widgets@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [b1e2d35]
- Updated dependencies [9733a1c]
  - @adminium/widgets@0.3.1
  - @adminium/engine@0.3.1

## 0.3.0

### Patch Changes

- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/engine@0.3.0
  - @adminium/widgets@0.3.0

## 0.3.0-rc.4

### Patch Changes

- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/engine@0.3.0-rc.4
  - @adminium/widgets@0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- @adminium/widgets@0.3.0-rc.3
  - @adminium/engine@0.3.0-rc.3

## 0.3.0-rc.2

### Patch Changes

- @adminium/engine@0.3.0-rc.2
  - @adminium/widgets@0.3.0-rc.2

## 0.3.0-rc.1

### Patch Changes

- @adminium/engine@0.3.0-rc.1
  - @adminium/widgets@0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.
- @adminium/widgets@0.3.0-rc.0
  - @adminium/engine@0.3.0-rc.0

## 0.2.9

### Patch Changes

- @adminium/widgets@0.2.9
  - @adminium/engine@0.2.9

## 0.2.8

### Patch Changes

- @adminium/widgets@0.2.8
  - @adminium/engine@0.2.8

## 0.2.7

### Patch Changes

- @adminium/engine@0.2.7
  - @adminium/widgets@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [9f47a62]
  - @adminium/widgets@0.2.6
  - @adminium/engine@0.2.6

## 0.2.5

### Patch Changes

- @adminium/engine@0.2.5
  - @adminium/widgets@0.2.5

## 0.2.4

### Patch Changes

- @adminium/engine@0.2.4
  - @adminium/widgets@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [ac3f5e7]
- Updated dependencies [9e1adf7]
  - @adminium/widgets@0.2.3
  - @adminium/engine@0.2.3

## 0.2.2

### Patch Changes

- 2dffc12: Stop a dead icon name costing a generated app its first paint, and put 64
  untranslated keys into the locale bundles.
  
  - `kanban-square` is not a lucide icon — it was renamed to `square-kanban`. It
    was emitted as `nav.icon` by the page generator, so any generated app with a
    workflow-shaped table fetched the entire ~137 KB icon catalogue on first paint
    to discover the name was dead, then drew the neutral `File` fallback anyway.
    A second instance, `bar-chart-3`, was found by the new gate.
  - `gen-icon-core.mjs` already computed the list of declared-but-unknown icon
    names and discarded it, printing only a count. It now fails in both `--check`
    and write mode, naming the offending file and the canonical rename.
  - `LUCIDE_ICON_NAMES` is now a real export. `allowedIcons` was documented as
    fed by it, that symbol existed nowhere, and nothing supplied the value — so
    the unknown-icon warning and the `table` fallback never fired and a model
    could store any hallucinated icon string on a table.
  - 64 `t()` keys existed in no locale bundle and rendered a hardcoded English
    default in all 8 locales, 56 of them the Settings → Languages & translations
    page itself — the one page whose keys the in-product translation editor
    cannot reach, because it refuses any key absent from the compiled bundle.
    All 8 bundles now carry them, translated rather than copied from English.
- Updated dependencies [0664dd4]
- Updated dependencies [2516a82]
- Updated dependencies [8477a70]
- Updated dependencies [cca257b]
- Updated dependencies [cca257b]
- Updated dependencies [8477a70]
- Updated dependencies [b204486]
- Updated dependencies [1002d67]
- Updated dependencies [8477a70]
- Updated dependencies [08df45d]
- Updated dependencies [66f0683]
- Updated dependencies [2dffc12]
- Updated dependencies [08df45d]
- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/widgets@0.2.2
  - @adminium/engine@0.2.2

## 0.2.2-rc.0

### Patch Changes

- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2-rc.0
  - @adminium/widgets@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/widgets@0.2.1
- @adminium/engine@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0
  - @adminium/widgets@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/engine@0.1.0
  - @adminium/widgets@0.1.0
