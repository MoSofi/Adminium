<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § Before you say it works; do not edit -->

# A website template as a working app: Before you say it works

1. `adminium app check`, then `adminium app build`, then `adminium app try`. Try reads every granted
   table and makes an empty create to each table that takes one.
2. Run the project with `adminium dev --host 127.0.0.1` and open every page. On all addresses
   (`0.0.0.0`, the default of older versions) the public API is not registered unless
   `ADMINIUM_TRUST_PROXY` is set, and the customer side cannot load its rows.
3. Compare each template page with its new page at the same window width, the whole page, and
   again at a phone's width with the menu open. Every difference is a fix, or a line in the summary
   saying why.
4. Put something in the cart, see the quote's total, and place an order. Send each form once.
