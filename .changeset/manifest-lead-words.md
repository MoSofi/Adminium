---
'@adminium/manifest': patch
---

New words for finding companies, read from Adminium 0.3.66: an add-on's `sources` (each key a secret setting of its own, each source's hosts reached through outbound-http), its `leads` tables (the people found and where each filled field came from, with the columns Adminium reads and writes, written by Adminium alone, never by a role, an app's grant or a step), and `lead` on an app's companies table, which says where a company's number, website, phone, address, activity, about and owner go. A package that provides the `lead-source` contract now says it needs Adminium 0.3.66 instead of being refused as an unknown contract.
