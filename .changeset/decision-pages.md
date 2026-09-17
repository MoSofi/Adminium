---
'@adminium/docs': patch
'@adminium/server': patch
---

**The decisions behind the architecture become public docs.**

- **A new "Decisions" section** under Anatomy on docs.adminium.dev, with one short page per
  decision that is load-bearing across the codebase: pages are settings rather than generated
  code, one process with no Redis, the three connections and where the meta store lives, the
  add-on trust model, one version for every package, tokens only with no `style` props, the i18n
  rules, the LLM never writing on its own, project code being trusted, and one npm package. Each
  covers the situation the decision was made in, the decision, and what it means for a
  contributor — including what it costs, where it costs something.
- **The comment rule that follows from it**, on the section's landing page: a comment says what
  the code does and why, and leaves the history to git and to these pages.
- **Two stale counts fixed.** The anatomy pages said "twenty workspaces" and "fifteen packages";
  there are twenty-one and sixteen.
- **A docs gate**, in `docs-contract.test.ts`: every page in the section must be linked from both
  the sidebar and the section's index, derived from the filesystem so a new page that nothing
  links is what goes red.
