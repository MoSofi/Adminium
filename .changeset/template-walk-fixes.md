---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
'@adminium/ui': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

Building from a site template, from a walk on a real model:

- A page and its stylesheet attached one by one are one template with one plan. Before, the stylesheet got an empty plan card of its own ("From style: 0 tables, 0 forms…"), and building it replaced the plan already approved, so the check before going live called things on that plan "not on the plan you approved". A stylesheet attached by itself is now brought in with no plan at all, beside whatever the side already has.
- Every plan a person approves for an app is kept. A second template's plan no longer takes away what the first approved, and an empty plan never takes the place of one with something on it.
- The plan lists only what the template has. Each thing it reports says where the template has it, and the server looks: a card payment or a search the template never had is refused. The model is also told which of the usual things the server did not find.
- Rows the template shows are called the template's own, also where no repeated block was found for them (the reviews of a slider), not "made up".
- A row's `id` goes with the columns a plan approves for reading, so a product page that links by id is no longer asked for as "beyond the plan".
- "Check this before it goes live" says what more a role could do: each table with the actions, the pages, a change of its limits. Before it said only "could do more than before".
- A refused step whose reason is a list shows the list's first lines. Before it showed only the heading ("The plan does not read:").
- An app made from a template is named after the business its pages name. When the name the model picks has nothing to do with the pages' titles or the person's words, it is handed the titles once before a name is taken.
- New checks, said to the model before a person meets them: `client.create` on a table whose public entry asks for rows below it (an order and its lines) is told to use `client.createTree`; `event.currentTarget` read after an `await` (or in a callback that runs later) is told to keep the element first; a field with no label and a link that holds only a picture with no `alt` are told to name it.
- A basket's total says what it takes in: the build instructions and the template guide now say a total is the sum of its lines, with delivery, tax or a discount as its own figure.
- Radio groups choose on an arrow key also when the key is pressed and released at once (a switch device, remote desktop or automation). Before, the focus moved and nothing was chosen.
- The sample-data guide says a sample row agrees with itself (no price beside "price on request").
- From a template, the plan comes before the app. In a new app, a model that starts writing tables, access and sample rows, or adds the side, before it has proposed the plan is told to propose it first (said in one reply, never a wall).
- A template's checkout is planned as an order with its lines, and a plan may not let a customer's page send a price or a total.
- A person who asks for no sample rows gets none: the rule for a first preview and the end-of-turn reminder both give way to their words.
- Rewriting the sample file tells the model the rows already added stay as they are, so it does not say the page changed.
- A zip refused for a file name in an old encoding names the file and says to rename it (on Windows, zipping again gives the same zip).
- The steps of a template build are said as what they are: reading the template, the plan approved or sent back, then building. Before, each read "Built N screens". A side that was not added no longer reads "Added screens".
- "Check this before it goes live" now sees what strangers may write to the rows below an entry's own (an order's lines). A manifest names them by their table, and they were read only as a list, so widening what a create writes to its lines was never asked.
- The manifest check refuses a row's key among what a public entry lets a browser write. Before, the check passed it and the apply stopped part way ("is the primary key and cannot be writable").
- The template finder sees a slider of reviews as a repeated block: who said a quote (`<cite>`) is a field of its own, so the plan can count the reviews as rows from the template.
- An app made from a template takes the business's own name: a name that only shares a word with it ("Fernhill Pottery" for "Fernhill Ceramics") is handed the page titles once, as an unrelated name is.
- Small wording for the model: a basket kept in the browser works and is not "not available"; a build names tables and columns as its plan does; rows keep the template's order on the page; the reminder about an empty first page leaves it empty when the person asked for no sample rows, in any language.
- An app stored before this release with a public entry the check now refuses (one that adds rows and leaves a browser nothing to set, or one that lets a browser write a row's key) is still read by what reads it: its forms, the record of a consent box, an add-on's settling. The entry is left out, as no endpoint was ever made for it, and the app's next apply says what to fix.
- A radio group inside a form reports an arrow-key choice once. The said-once note about a template's checkout is said per app, not once for every app built from the same template. Only the person's own words count as theirs for an app's name and for "no sample rows": the server's notes about an attached file do not, and "I have no sample data, make some up" asks for rows.
