---
'@adminium/llm': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/i18n': patch
'@adminium/dashboard': patch
'@adminium/docs': patch
---

**A page assistant that drafts in the page's own format, and never saves.**

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
