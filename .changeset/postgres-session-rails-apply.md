---
'@adminium/adapter-postgres': patch
---

**The Postgres session settings now actually apply.** Three ways they did not,
all silent, all on connections Adminium opens to your own database.

**An `options=` in the DSN outranked ours.** `pg` resolves connection parameters
as `Object.assign({}, config, parse(connectionString))`, so the parsed
connection string wins — the opposite of what this adapter's own comment
claimed. A source DSN carrying `options=` therefore dropped `statement_timeout`
and `lock_timeout` entirely, on a direct endpoint as much as a pooled one, with
no error raised and nothing in the log: the rails were simply absent on every
connection. The DSN's `options` is now lifted out of the connection string and
re-joined after ours, so ours win a conflict — a repeated `-c key=value`
resolves to the final assignment — while anything else the operator set, a
`search_path` say, still survives. Theirs is kept across the pooler downgrade
too, deliberately: a pooler refuses their startup options exactly as it refuses
ours, and such a DSN should fail with a hint naming `options=` rather than have
a setting discarded behind their back.

**The pool that reads rows had no budget at all.** `createQueryEngine` built its
pool bare while the adapter's own pools have carried 05 §4.1's rails since M3,
so a runaway CRUD query — a bad filter over a large table — had nothing to stop
it scanning until the client gave up. It now sends the data role's settings,
through the same `buildSessionSettings` call the adapter makes, so the two
cannot drift apart.

`SET LOCAL` is not available as the pooler fallback there. Kysely speaks the
extended query protocol, one statement per Parse, so there is no multi-statement
message to carry a prelude in and the trick `PostgresAdapter` uses does not
transfer. `query_timeout` is no substitute either: it abandons the client's wait
and leaves the backend running, which is the opposite of the guarantee. So
behind a transaction pooler that pool keeps working without a server-side
budget, exactly as it did before — every mechanism that would impose one sets
the timeout on a backend the pooler then hands to somebody else, which is
precisely what 05 §4.1 refuses to do. Direct endpoints, and session poolers, get
it. The connect guide now says which is which.

Kysely holds a facade rather than the pool itself, because the refusal lands
inside `connect()` and that is where the one-time downgrade has to live; handing
it the raw pool would have turned the refusal into a hard failure and stopped
Adminium reading rows from a Neon database at all. A refusal is attributed to
the pool that was *used*, not to global state, so checkouts racing a rebuild
retry against the new pool instead of failing outright.

**And the pooled-endpoint hint sent you to fix the wrong thing.** It still read
"use the direct/unpooled connection string" — copy from before the adapter
learned to downgrade to a `SET LOCAL` prelude on the first refusal. That
downgrade means a pooled string simply works and the hint is unreachable on that
path: it can only fire *after* the retry, on a pool that no longer sends options
of its own, so what was refused is the DSN's own `options=`. That is what it
names now. The Neon and Supabase host rewrites stay on as the fallback, since
they still resolve it.
