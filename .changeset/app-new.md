---
'@adminium/server': patch
---

`adminium app new <key>` writes a starter app into a project: one table, one dashboard page, one role and sample data, with its manifest as part files, and with `--staff` and `--customer` a side each. An app's screens import their plumbing from `@adminiumjs/adminium/side`: `useStaff()` gives a staff side a session that reads and writes the app's tables as the signed-in person, with the venue's time zone and currency, and `useCustomer()` gives a customer side the browser key and address to make its public client with.
