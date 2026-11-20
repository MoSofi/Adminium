<!-- produced from apps/docs/src/content/docs/reference/cli.md § `check-source`; do not edit -->

# CLI reference: `check-source`

```
adminium check-source < dsn.txt
```

For an operator who offers trials on their own server: checks a database the
way a trial would connect it as the user's own, before the trial is made. One
connection string on stdin (never an argument, which every process on the
machine can read). It must be on a database port (1024 or above, not a known
non-database service), at public addresses only (none in
`ADMINIUM_DATABASE_DENY_ADDRESSES`), and over TLS unless the string turns it
off. Reads the catalog only, never a row, within 15 seconds. Needs no meta store
and no `ADMINIUM_SECRET`.

It prints one JSON line:

```json
{"ok":true,"class":"ok","engine":"postgres","version":"16.4","tables":[{"id":"public.orders","schema":"public","name":"orders","columns":["id","total"],"links":["public.customers"],"estimate":1200}],"schemas":["public"]}
```

`class` is one of `ok`, `auth`, `unreachable`, `dns`, `tls`, `refused-by-us`,
`ipv6-only`, `no-database`, `no-permission`, `too-many` (more tables than a
trial takes; the first 500 are listed) and `empty`. `columns` lists up to 200
names, `links` up to 50 referenced tables, `schemas` up to 100.

Exit codes: `0` when the class is `ok`, `1` for every other class, `78` when
`ADMINIUM_DATABASE_DENY_ADDRESSES` is not a list of addresses and CIDR ranges.
The command is left out of `adminium --help`.
