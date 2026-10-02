<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § The human check; do not edit -->

# An app's public access: The human check

A browser key sits in a page anyone can read, so a script can book as easily as a person. An app
can ask for a small **proof of work** before a stranger's create, and before every claim. The page
asks for a challenge, solves it, and sends the answer with the request:

```bash
curl 'https://admin.example.com/api/v1/public/challenge?purpose=write' -H "Authorization: Bearer $ADMINIUM_KEY"
# → { "data": { "id": "…", "salt": "…", "difficulty": 16, "expiresAt": … } }
# then:  x-adminium-proof: <id>.<nonce>
```

- A challenge is `write` or `claim`, and lasts 2 minutes. Solving it takes about a second on a
  cheap phone. [`@adminiumjs/public-client`](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/) solves it in
  the background and retries once.
- **One proof, one request.** A proof is spent when it is checked, on every server at once, even
  if the write is then refused. The page solves a new one for the next try.
- **Who is excused:** a person signed in through the key's identity, on an entry that caps their
  open rows; a [kiosk](https://docs.adminium.dev/guides/apps/public-access/#a-kiosk); a server key.
- A missing, wrong, expired or used proof gets one answer: `403` `PUBLIC_PROOF_REQUIRED`.
- Several creates in one batch on an entry that asks for a proof are refused whole.

The proof makes each request cost something. It prices out a careless script, not a determined
one: the limits below are what bound abuse.
