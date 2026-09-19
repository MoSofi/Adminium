---
title: Why Adminium is built this way
description: Eleven decisions that are load-bearing across the whole codebase — what each one rules out, and what it means if you are about to change code that depends on it.
---

Some decisions in Adminium show up in hundreds of files. They are not style
preferences and they are not settled by a vote in a pull request: change one and
a lot of unrelated code stops making sense. This section is one short page per
decision, so the code can point at the reasoning instead of carrying a
paragraph of it.

Each page has the same three parts: the situation the decision was made in, the
decision itself, and what it means for you if you are working in that area.

| Decision | In one line |
|---|---|
| [Pages are settings, not generated code](/anatomy/decisions/pages-as-settings/) | A page is a row with a JSON config, not an emitted component. |
| [One process, no Redis](/anatomy/decisions/one-process/) | The queue, the scheduler and the rate limiter live in the database and in memory. |
| [Three connections, and where the meta store lives](/anatomy/decisions/three-connections/) | Introspection, data and Adminium's own tables never share a handle. |
| [Add-ons are trusted because they are first-party](/anatomy/decisions/add-on-trust/) | An add-on's server half is not sandboxed, so the gate is at install time. |
| [One version for every package](/anatomy/decisions/one-version/) | Twenty-one workspaces move together on one number. |
| [Tokens only, no `style` props](/anatomy/decisions/tokens-only/) | Every colour, space and radius is a CSS custom property. |
| [The i18n rules](/anatomy/decisions/i18n-rules/) | Eight locales from day one, and a key that exists in seven is a build failure. |
| [The LLM never writes on its own](/anatomy/decisions/llm-never-writes/) | A model produces a proposal; a person accepts it; one transaction applies it. |
| [The assistant proposes, a person saves](/anatomy/decisions/assistant-proposes/) | The page assistant's last move is a draft; saving is a separate, confirmed, audited act. |
| [Project code is trusted](/anatomy/decisions/project-code-is-trusted/) | Code in a project folder is the operator's own, and runs unsandboxed. |
| [One npm package](/anatomy/decisions/one-npm-package/) | The internal packages ship inside the flagship tarball, not beside it. |

These pages are reasoning, not reference. [How Adminium works](/anatomy/)
describes the machinery as it is, and
[the packages, one by one](/anatomy/packages/) covers each workspace's surface.

## The comment rule

Since these pages exist, comments in the source have a narrower job: say what
the code does and why it does it that way, and leave the history to git and to
this section. A comment that needs three paragraphs of backstory is pointing at
a decision that belongs here.
