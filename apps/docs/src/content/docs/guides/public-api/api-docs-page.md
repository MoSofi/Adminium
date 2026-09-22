---
title: The API documentation page
description: Publish /api-docs — a page anyone can open to browse the endpoints your live keys can call, read their columns, and try a request with a key they paste.
---

`/api-docs` is a page for the people who call your API. It needs no account and has no
dashboard around it. It is **off** until you switch it on.

## Switch it on

In **Workspace settings → Public API**, turn on **API documentation page**. The page
and its data route (`GET /api/v1/api-docs`) are served from the next request. Switched
off, both answer the ordinary not-found response, exactly as on a server that never had
the page.

The switch is not part of a config bundle: publishing a description of your database is a
decision for this instance only.

## What it shows

Only what somebody can call. The page lists the stored endpoints that at least one live
key grants, with the methods those keys were granted. It does not list a generated
endpoint no key uses, or a method no key holds. Service role endpoints are listed when a
server key grants them.

For each endpoint it shows the path, the auth level, the default and maximum limit, the
default order, and the columns with their types and PK, UNIQUE or FK tags. For writes it
shows the columns a write may carry.

It never shows a table's real name, an endpoint's filters, a row count, any row or any
key. With one connection, the connection's name is not shown either.

Anyone who can reach this server can open the page. On a domain mapped to a hosted app,
`/api-docs` belongs to that app and this page is not served there.

## The playground

Paste a **browser** key and **Send request**. The page sends a real request with that
key and shows the real status, the time it took and the body, including a refusal and its
code.

- The key stays in the page's memory. It is never stored, never put in the URL or in a
  code sample, and is gone when you reload.
- Your own dashboard session is not sent with the request.
- A server key is refused, because a server key is never accepted from a browser.
- The request comes from this instance's own origin, so it works only when
  `ADMINIUM_PUBLIC_API_ORIGINS` includes `self`. Otherwise the answer is
  `PUBLIC_ORIGIN_REFUSED`, which is the truth about that key from this page. `self` also
  admits every other page this instance serves.

The code samples (cURL, JavaScript with `@adminiumjs/public-client`, and Python with
`requests`) use this deployment's address and the real paths, headers and bodies. They
name the key `$ADMINIUM_KEY` and never contain the key you pasted.

For the full contract, see [Endpoints and keys](/guides/public-api/endpoints-and-keys/).
