---
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/i18n': patch
'@adminium/dashboard': patch
---

Email templates become email documents (39-email-templates-and-campaigns.md
WS-A/WS-B). Migration 0026 gives `adminium_email_templates` a kind
(template | campaign), a category, a fixed footer, a preheader, a per-document
brand, attachments, archiving and starter provenance, and adds
`adminium_email_blocks` (saved sections) and `adminium_email_runs` (campaign
runs). The renderer speaks the comp's 24 block types, draws the brand banner
and the envelope footer, and references the brand mark and Files images by
CID; delivery reads attachment bytes from the file store right before
`sendMail` and fails loudly on a missing file. Twelve localizable starters ship
behind `GET /email-templates/starters`.

Routes: `PUT /email-templates/:key/:locale` and `POST /email-templates/:key/test-send`
are retired — the editor saves explicitly through `PUT /email-templates/:id`,
and a test send carries the on-screen document (`POST /email-templates/:id/test-send`,
up to ten recipients). New: create (blank or from a starter), duplicate, add a
language variation, start a campaign from a template, archive/restore, delete
(a built-in resets instead), export/import of a JSON bundle, and saved blocks
under `/email-blocks`. Settings gain `email.senders` and
`email.maxAttachmentBytes`.

Campaigns, phase 1: `POST /email-templates/:id/send` (workspace users, optional
roles, now or scheduled) creates an `adminium_email_runs` row and one
`email.campaign-run` job; `POST /email-templates/:id/audience/preview` counts
recipients and opt-outs; `GET /email-templates/:id/runs` lists a campaign's
runs; `POST /email-runs/:id/cancel` cancels a scheduled run or cooperatively
stops a running one. The `email.campaign` notification kind is the opt-out;
`email.campaign.sent` tells the creator how many were sent and failed.

Dashboard: the Email templates manager is rebuilt to the design (WS-C, 39-T08–T10):
Templates/Campaigns trays with counts, group by topic or language, gallery and
list layouts remembered per browser, the actions menu (import, senders, export,
settings, archived), inline rename, duplicate and delete with Undo, archived
mode with restore / delete for good / reset to built-in, the New modal with the
twelve starters and *Your templates* for campaigns, and the import modal. The
old autosaving page under `pages/builders` is gone; the editor route
(`/email-templates/:id`) shows the document's facts until the new editor lands.

The Email templates surface's messages move to a deferred `email` namespace
(`DEFERRED_NAMESPACES`), loaded by its two routes like the studio's: the
strings no longer ship in every user's entry chunk. `GET /i18n/bundle/:locale/email`
serves it; the overrides budget counts it.

The editor (39 WS-D/WS-E): a live canvas of the 24 block kinds plus the two
legacy ones, inline subject and preheader, the inspector's Sections and Design
tabs (five panels, a rows editor, eight style axes, saved blocks), explicit save
with `Ctrl/⌘+S`, sixty steps of undo, a discard-changes guard, language
variations with the mirror question for structural edits, the image picker
(workspace files, upload with the connection rule, https URLs), workspace
documents as attachments, test sends of the on-screen document to several
addresses, and — for a campaign — *Send campaign* (workspace users by role,
now or scheduled, the live recipient count), the *Scheduled · time* / *Sending
· N %* chip with an explicit cancel, and live progress on the run's job channel.
Every string of the surface, the twelve starters and the blank copy are in all
eight languages. Two guides (`guides/email/`, `guides/email/campaigns/`) document
templates, campaigns, attachments, senders, opt-out and what is not tracked.
