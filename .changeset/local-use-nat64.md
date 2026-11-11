---
'@adminium/server': patch
---

Addresses under the local-use NAT64 prefix (`64:ff9b:1::/48`) are now read for the IPv4 address they carry, as `64:ff9b::/96` already was, so one that reaches a cloud metadata address, the server itself or its own network is treated as that address.
