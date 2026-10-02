# @adminium/llm

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
