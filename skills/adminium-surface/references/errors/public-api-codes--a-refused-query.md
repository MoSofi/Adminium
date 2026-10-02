<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — A refused query; do not edit -->

# Error codes: Public API codes — A refused query

### A refused query

`400` `PUBLIC_QUERY_REFUSED` answers a read the endpoint does not take:

- a filter or a sort on a column it does not allow, or on a [withheld
  column](https://docs.adminium.dev/reference/manifest/#withheld-columns);
- a search on an endpoint with no searchable column;
- `?code=` on a list or on availability: a code travels in the `x-adminium-code` header, never in
  the address, which logs and proxies keep;
- an endpoint that answers one row, when more than one matched;
- an availability question with a parameter its limit does not take, or without one it needs:
  a slot limit takes the `party` and one `date`, or a `from` date and `days` (the original single
  slot rule takes one `date` only); a parent limit `under`, `date`, `qty`, `exclude`, `code`; a
  night limit `from`, `to` (31 nights at most), `guests`, `earliest`, `exclude`; a booking rule a
  `kind` and one `date`, or a `from` date and `days`;
- a malformed request: an unknown parameter, a value out of bounds, a cursor this list never gave;
- U+0000 in a path or query parameter, which `params.parameter` names.
