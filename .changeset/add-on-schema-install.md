---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Installing an add-on now creates the tables it declares.

Until now an add-on whose `requiredSchema` named a table the database did not
have was refused whole, with `ADD_ON_DDL_REQUIRED` and a list of table names.
That covered every add-on attaching to data a host already had, and refused the
three shipped ones that bring their own.

**There is no SQL in the implementation, and that is the point.** The work was
priced as a `requiredSchema` → DDL emitter written three times, once per
dialect, because the only existing exemplar — the desktop runtime's SQLite
importer — is exactly that. It was not needed: a connection hands back a real
Kysely instance, whose schema builder already compiles `CREATE TABLE` correctly
for postgres, mysql and sqlite. What was actually missing was a map from the
manifest's fifteen abstract column types to a column type per dialect, and the
rules for what order to create tables in.

Three entries in that map differ from the meta store's answer for the same
abstract type, and each difference is deliberate. An `id` is `varchar(36)` and
never `char`, because a blank-padded character column hands the padding back on
every read. A `timestamptz` is a real timestamp rather than the epoch-
milliseconds integer the meta store uses, because these tables sit in the
operator's own database beside their own data, where a `created_at` holding
`1750000000000` is unreadable to every other tool they point at it. And `money`
is `decimal(19,4)`, because binary floating point cannot represent a tenth of a
cent.

**A foreign key names a table, not a column,** so the target's primary key has
to be resolved — from the manifest for a table this install is creating, from
the live schema for one the host owns. A target with a composite primary key, or
none, is refused rather than guessed at: assuming `id` would create a constraint
against a column that may not exist. Constraints are emitted named and
table-level, because MySQL parses the inline column-level form and then silently
discards it.

**The install is re-runnable rather than transactional,** which is the only
property MySQL leaves available — it commits each DDL statement implicitly, so a
multi-table install cannot be rolled back. Every create is `IF NOT EXISTS`,
tables are emitted in dependency order, and the DDL runs *before* the manifest
row is written. A failure halfway leaves real tables and nothing registered, and
retrying completes the install rather than colliding with it. The reverse order
would leave an add-on registered against tables that are not there.

**Which database an add-on installs into is now answered explicitly.** An
instance may have several connections and a manifest names none. The tables go
where the host app it attaches to reads — which is the only answer that makes a
foreign key into the host's data possible — falling back to the sole connection
when the add-on attaches to no app in particular. When neither rule resolves,
the install is refused and says why. Creating tables in the wrong database
succeeds, returns 200, and is discovered much later by an operator wondering why
an add-on's list is empty.

The consent dialog says all of this before anyone agrees to it: it names the
tables that will be created, and repeats that uninstalling later leaves them and
their data alone. That promise is now checked against a database rather than
asserted — install creates a table, a row goes into it, the add-on is
uninstalled, and the row is still there.

**One thing install still refuses:** adding columns to a table that already
exists. Creating a table an add-on asked for is one conversation; altering one
the operator already owns is a different one, and it is theirs to have. The
dialog names the missing columns instead of offering a button that fails.
