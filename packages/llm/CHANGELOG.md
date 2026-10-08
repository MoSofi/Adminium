# @adminium/llm

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
