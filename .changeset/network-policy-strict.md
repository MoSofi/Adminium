---
'@adminium/server': patch
---

A new `ADMINIUM_NETWORK_POLICY` variable decides whether Adminium may call machines on the server's own network (`10.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x`, IPv6 `fc00::/7`). `open`, the default, keeps today's behaviour. `strict` refuses them for source databases, automation webhooks and S3 or WebDAV storage; a source database named in `ADMINIUM_DATABASE_HOSTS` still connects, and the list never opens webhooks or storage. Cloud metadata addresses stay refused under both. Webhook URLs are now looked up before every send, every address the name gives is checked, and the request goes to the address that was checked, so a name cannot point somewhere else a moment later. A host name that cannot be looked up now fails with its own error, `Could not look up <host>` (code `HOST_LOOKUP_FAILED`, status 502), instead of reading like a refusal. The desktop app ignores `ADMINIUM_NETWORK_POLICY`.
