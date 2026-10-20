<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § The feature report, before the build; do not edit -->

# A website template as a working app: The feature report, before the build

Before anything is written to the app, give the person one plan to answer, made from the
inventory:

1. **What becomes a table**: each table, its columns in plain words, the pages that show it, and
   how many of the template's blocks are filler (the same item repeated to fill a grid).
2. **What the forms do**: each form, the table it writes to, and that strangers can add to it,
   with limits.
3. **What the template shows**, every feature of it, each marked:
   - **Works**: Adminium does it now (the product pages, the cart and the order, the contact form).
   - **Works with an add-on**: it works once that add-on is installed (coupons: Offers), and
     whether it is installed.
   - **Not available**: Adminium does not do it. Say what the template promised and why it is
     not there.
4. **Links to nowhere** (`#`): social profiles, "Learn more". Ask for the addresses, or take the
   link out.

For each one not available, the person chooses:

- **Build it.** Say plainly what building takes, and its limits:
  - inside the app (a screen, a column, a page): built now, and the app still installs elsewhere
    as one file;
  - with code of the project's own on the server (`hooks/`, `actions/`), and an outside service
    where it needs one (a payment service, a mail service): the account is the person's own, and
    its key goes in the project's `.env`, put there by the person, never by you. The project
    folder is then the thing to deploy, not an app file: a packed app carries no server code, so
    the feature does not travel with it.

  Where no code can do it (a script or a frame from another host), say why, and offer the other
  two.
- **Replace it** with what Adminium offers, and say what the page then shows: a bank transfer that
  staff mark paid in the dashboard, in place of a card form.
- **Leave it out**: the part is taken off the page, and the summary says so.

The usual ones in a shop template:

| The template shows | Status | Build it | Replace it |
|---|---|---|---|
| Card or PayPal payment | not available on the page: the public API takes no payments | a payment link per order from the person's payment service, made by the project's server code, with a staff button that checks it was paid | payment by transfer or on delivery, marked paid by staff |
| "Create an account", "Log in" with a password | not available: guests have no passwords | a sign-in service of the person's, joined by the project's server code; a large piece of work, say so | a guest finds their own order by an emailed code ([a person and their own rows](https://docs.adminium.dev/guides/apps/identity-and-own-links/)) |
| A search box | works in the screen: a public list takes no search (`q` is refused), so the screen searches the rows it loaded | | |
| Sending the newsletter | not available: the list is kept, nothing is sent | the project's server code sending through the person's mail service | export the subscribers from the dashboard to a mail service |
| A blog post's own page, a product's own page | works, when built inside the app: the template has no such page | a page at `/blog/:slug` in the template's styles | |
| A chat widget, analytics, an embedded video from another site | not available: no script or frame from another host | no code can: the content policy is the server's | a link to the service |

Ask it all in one message, and build only what the person approved: a choice made after the build
means building something twice (a card form, then a bank transfer in its place), or throwing it
away. Keep the answers in the app's brief, `apps/<key>/design.md`, under "From a template", so a
later session does not ask again or undo them.

In Adminium Designer this is one card, asked before anything of the template is written. `use_site`
first returns what the server found in the template (its repeated blocks with their fields, its forms,
a cart, the features and the links to nowhere), and then takes the plan. The person reviews it in one
sheet (**Review the plan…**): what becomes a table, what the forms do, what the template shows with
**Build**, **Replace** or **Leave out** for each thing not available (Replace is picked where there is
one, never Build), the links to fill, and what is added to the project. The answer is kept in
`apps/<key>/template-plan.json` with the template's sha256, and the system prompt says what it
approved, so a later session neither asks again nor undoes it, and a different template asks again.
Then, in a session that holds a template, the server asks **Check this before it goes live** only for
what lets strangers do more, or a page call an outside address, beyond what the plan approved. On a
model that reads too little at once for a template, `use_site` refuses before the plan. When the site works, say in a short summary what was
built, what was replaced and what was left out, and which sample rows are filler.
