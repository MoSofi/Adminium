<!-- produced from apps/docs/src/content/docs/guides/public-api/endpoints-and-keys.md § Keys; do not edit -->

# Endpoints and keys: Keys

A key is a selection: endpoints, and under each one the methods it may use. One key can
cover many endpoints with different methods on each.

- A **browser** key (`adm_pub_…`) is for pages. It works only from the origins
  `ADMINIUM_PUBLIC_API_ORIGINS` lists, and it can be revealed again later.
- A **server** key (`adm_srv_…`) is for your own backend. It needs no `Origin`, is shown
  once and cannot be revealed, and is refused from a browser. Only a server key can be
  granted a **service role** endpoint.
- An **app** key (`adm_app_…`) is for a phone app. Like a server key it needs no `Origin` and is
  refused from a browser; in everything else it is a browser key: a visitor's reach and limits,
  the human check, and it can be revealed again. It is not made here: an app with a
  [phone app](https://docs.adminium.dev/guides/apps/phone-app/) gets one when it is installed.

A key expires after 30 days, 90 days or never. **Revoke** ends it on the very next
request, and within 5 seconds on any other replica of this server.

> **Caution: A browser key is public**
> A browser key sits in your page's source, so anyone can copy it and call exactly what it
> grants. If it grants POST, PATCH, PUT or DELETE on an endpoint with no default filter, the
> person who copied it can create, overwrite and delete every row of that table. A
> generated endpoint also lets a caller write every exposed column. That includes columns
> such as `role` or `price` that your own app treats as authorization, so on a `users` table
> a copied key can change someone's role.
>
> Give a browser key the read-only preset unless the page must write, add a default filter
> to every endpoint it writes through, and remove authorization columns from `writable`.
