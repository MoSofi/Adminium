<!-- produced from apps/docs/src/content/docs/reference/offers-shapes.md § Checking the fit; do not edit -->

# Offers shapes: Checking the fit

The four shapes are in the add-on's manifest (`addOn.shapes`) and, one file each, in its source
(`packages/offers/src/shapes/` in the add-ons repository), beside the check that reads them
(`src/testing/fit.ts`, the function `shapeFit`). An app copies the shape files it adopts and that
one file into its own repository, and calls it in its own tests with its manifest, which of its
tables stands for which part, and the shapes:

```ts
const pairings = [
  { table: 'orders', shape: 'discountable@1', part: 'order' },
  { table: 'order_lines', shape: 'discountable@1', part: 'lines' },
  { table: 'order_codes', shape: 'discountable@1', part: 'codes' },
];
expect(shapeFit(manifest, pairings, [discountable])).toEqual([]);
```

It answers a list of what does not fit: a column that is missing or of another type, a rule that
names the wrong column, a posting that fires at another point. An empty list is a fit. Because the
files are copied, an app's tests do not need the add-on installed.
