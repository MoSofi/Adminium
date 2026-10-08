<!-- produced from apps/docs/src/content/docs/reference/offers-shapes.md; do not edit -->

# Offers shapes

From Adminium 0.3.19, add-ons 1.0.9.

An app that builds on [Offers & gift cards](https://docs.adminium.dev/guides/add-ons/offers/) does not import anything from
it. The app writes, on its own tables and under its own column names, the rules below. Each group
of rules is a **shape**. The add-on's manifest lists the four shapes, and its source has a check,
`shapeFit`, that an app runs in its own tests to hold its tables to them.

A column named here is a column the app must have under a name of its choosing; the rule names the
app's own column. "Adminium writes it" means the app never sends a value for it.
