<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § What the page shows; do not edit -->

# Installing add-ons: What the page shows

Each add-on is a card: its name and one line about what it does, both in your
own language where the catalog carries a translation; the categories it belongs
to; and whether installing will ask you for a credential — an API key or an
OAuth connection — before you download anything. A category rail on the left
filters the grid and shows how many add-ons sit in each one, and the search box
matches names and descriptions.

The card tells you what an add-on *is*. It deliberately does not list what the
add-on may reach: that belongs to the install plan, which appears when you press
Install and names every table and every host before anything is registered.

> **Note**
> A checkout running from source (`pnpm dev`) ships **no bundled set** — those are
> baked into the Docker image and the desktop app at build time. So a source run
> shows an empty catalog until you switch browsing online on, or upload a package
> yourself. That is expected, not a misconfiguration.
