---
'@adminium/meta': patch
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Add-ons can now be installed, attached to a host, switched off per host, and
uninstalled — and `manifests.manage` became a real permission.

Plan 32 got a verified package onto local disk and stopped there. This is the
first half of what happens next: the meta surface, the install planner, and the
routes. It is deliberately not the whole runtime — see the end for what still
refuses.

**`adminium_manifests` already existed.** It has shipped since migration 0006
with no repo, no writer and zero rows, and three planning documents recorded it
as absent. So migration 0020 ALTERs rather than creates, adding `kind`, and
`licenseKeyEncrypted` — a column plan 17 defers by name — is left in place and
read by nothing rather than dropped, because it is empty and dropping a column
is the one thing a migration cannot take back.

**Attachments are a join table.** The wave's plan originally recommended two
manifest rows keyed `(manifest_key, attached_to)` for an add-on attached to two
hosts; that recommendation was withdrawn and the join table ratified. Three costs argue against it, and the
third only became visible once the table turned out to be shipped: two rows mean
two copies of the manifest document, which an upgrade must then rewrite
atomically or leave one host on an older version; the credential FK becomes
ambiguous, since a DHL API key belongs to the add-on rather than to one of its
attachments, so disconnecting "the other one" either orphans a secret or deletes
a live one; and it requires dropping and recreating the shipped
`uq_adminium_manifests_manifest_key` across three dialects, against §4's own
"never edit a shipped migration". An attachment is a many-to-many fact and now
has the table that models one. `disabledAt` lives there rather than on the
manifest, so an add-on can be live on one host and off on another — which a
single flag could not represent.

**Credentials get their own key, not the DSN's.** `deriveKey`'s `info` parameter
exists to keep purposes apart, and these are genuinely different: a DSN opens
the operator's own database, an add-on credential opens a third party's API on
their behalf. Sharing a key would mean a leak of either is a leak of both, and
rotating one to contain an incident would silently invalidate the other. The
ciphertext column is called `payload`, which none of the log-redaction patterns
matched — `payload` is now redacted, along with `refreshToken` and `accessToken`.
That will redact some innocent job payloads too; an un-redacted credential in a
log costs more than a debugging session does.

**`planInstall` is a document, not a step.** The consent dialog is the security
surface, so what it shows had to be computable without side effects and
renderable even when the answer is no — a refusal is data, not an exception that
leaves the dialog with nothing to draw. The case that makes it non-trivial is
the foreign key pointing *out*: two of the three shipped add-ons that declare
tables reference tables they do not own (`design-studio.job_id → jobs`,
`personalizer.product_id → products` and `order_line_id → order_lines`). Those
belong to the host, so a reference resolves as internal, host, or unresolved,
and only the third stops an install. A planner that only emitted DDL would find
that at `CREATE TABLE`, having already created the other tables — on MySQL,
which has no transactional DDL, permanently.

**`manifests.manage` is grantable, in the same change that landed its first
enforcement point** — which is the rule its own reserved list documents. It went
to `operations` rather than `workspace`: installing an add-on runs its server
half in this process, which is closer to starting a job than to changing a
setting, and 26 D3 exists precisely to stop it riding on `settings.manage`. The
reserved set had four hard-coded copies rather than the two that were expected,
and one of them is production code — `RESERVED_GRANTS` in the dashboard's
`rolesApi.ts`, which the dashboard cannot import from `@adminium/meta`, so
nothing detects drift and a key left there is silently dropped from the matrix
with no error and no failing test.

Applying a plan that needs new tables lands in the same release — see the
add-on schema changeset — so an add-on whose tables the host database already
has and one that brings its own both install completely.

Uninstall deletes the meta rows and the package directory and touches the data
source not at all, so every table an add-on brought stays with its rows; the
reply says so, rather than leaving the UI to assert it. And 26's acceptance #8 —
"a composeServer-level test that fails if a route is exported but unregistered"
— finally has one. Nothing enforced it before: the M10 regression test checks a
hard-coded URL list, audit coverage only sees routes that are registered, and
the OpenAPI check reads the built spec. All three are blind to exactly the gap
that shipped green twice.
