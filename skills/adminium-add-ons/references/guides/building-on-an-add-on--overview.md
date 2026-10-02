<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md; do not edit -->

# Building on an add-on

An add-on can define a **shape**: the tables a job needs, with the rules Adminium keeps on them.
The Invoices & Receipts add-on (`invoices`) defines `invoice@1`: a document, its lines and its
payments, with gapless numbers, exact totals in the currency's decimals, a balance that never goes
below zero, a draft–sent–void life, reminder emails and printed invoices and receipts.

An app that sends invoices does not have to invent any of that. It builds its own tables on the
shape and adds what is its own: its clients, its projects, its portal. This page walks through
such an app, a small studio that bills its clients. Every field it uses is listed in the
[manifest reference](https://docs.adminium.dev/reference/manifest/).
