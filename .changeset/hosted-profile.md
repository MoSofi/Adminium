---
'@adminium/server': patch
---

The hosted profile (`ADMINIUM_HOSTED_MODE=on`), for a paid installation on an operator's server, now has its own section in the self-hosting docs: what it keeps from a trial (the database host list and login, `strict`, files in the data folder, no own add-on or app uploads, a Designer that builds without code, the operator's addresses and domains, the operator endpoint and its hide switch), what it drops (the end date, banners, size caps, `noindex`, relay-only mail and AI only on the operator's connection), what the operator sets, and what changes at the Upgrade from a trial: the same meta store, data folder and secret, every `ADMINIUM_TRIAL_*` variable removed, and writes taken again from the first request while a hide the operator set on the public pages stays until lifted. A new test boots a trial, the same trial past its end and then the hosted profile on one meta store, on SQLite, PostgreSQL and MySQL.
