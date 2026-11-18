---
'@adminium/server': patch
---

An add-on's refused or failed outside call is now recorded without the address's query string, in the audit log and in the error the add-on is handed, and a failed call no longer quotes the network error's own words. Some services take their key in the query string, so a key could otherwise have been written to the audit log. A lead source's refusal is also cleared of its key in every form a web address carries it.
