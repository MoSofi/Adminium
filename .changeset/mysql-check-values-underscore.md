---
'@adminium/adapter-mysql': patch
---

**MySQL: an allowed value with an underscore is read whole.**

Reading a MySQL table's list of allowed values cut the end off any value containing an underscore
(`gift_card` read as `gift`, `no_show` as `no`), so Adminium refused values the column allows, and an
app update tried to change lists that were already right.
