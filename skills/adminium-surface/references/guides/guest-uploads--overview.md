<!-- produced from apps/docs/src/content/docs/guides/apps/guest-uploads.md; do not edit -->

# Guests' uploads

A print shop takes the customer's artwork with the order. A sign maker takes the logo to cut. The
customer is a guest on the app's public pages, with no account in the dashboard, so the file goes
through the [public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/): the page uploads it first, then
names it in the order it sends. Once the order is saved, the file is the order's, as a file staff
upload is.

Needs Adminium 0.3.43.
