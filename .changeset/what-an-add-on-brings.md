---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
'@adminium/add-on-contracts': patch
'@adminium/widgets': patch
---

An add-on that keeps tables can now bring the rest of what it needs. Its own pages read and write those tables through a data kit of the dashboard's parts and hooks (`hostApi: 2`), with the reader's own grants. A manifest may ship automation rules (`automations`), listed on the rules page under "From your add-ons" and "From your apps": the owner switches them or edits a copy. An add-on may put a tab of its rows on another table's record (`addOn.recordTabs`), and answer "in stock, low or out" for the rows a page asks about, for customers and for staff (`addOn.words`). A generated record page takes the app's own buttons (`states.actions`), a list takes up to two actions on the ticked rows, and a dashboard's toolbar up to two links. An app's role may hold an add-on's tables (`roles[].tables`). One look-up finds a typed or scanned code across an add-on's tables (`addOn.lookUp`). An add-on's page asks for a document on the paper it wants, and a document that prints a gift card's code is drawn when asked and kept nowhere. An email block can depend on a value (`onlyWith`, `onlyWithout`), an add-on's email can link into the app it serves (`{{app_url.<name>}}`), and an email or a document can list an add-on's rows for an order.
