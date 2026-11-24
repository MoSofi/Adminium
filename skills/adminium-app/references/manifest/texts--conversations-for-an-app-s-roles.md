<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Texts — Conversations for an app's roles; do not edit -->

# Manifest spec: Texts — Conversations for an app's roles

### Conversations for an app's roles

A customer's reply can say anything, so nobody but the Super Admin reads conversations until given
the right. An app's role can be given its own app's conversations:

```json
"roles": [{ "key": "front-desk", "name": "Front desk",
            "permissions": ["table:@guests:read", "texts:@:read", "texts:@:reply"] }]
```

| Grant | What it allows |
|---|---|
| `texts:@:read` | Read this app's conversations. |
| `texts:@:reply` | Read and answer them, and text the number on a record of this app the person can open. |

`@` is this install. The grants need Adminium 0.3.76 or later. Every read and answer is audited. An
API key never reads or answers a conversation.
