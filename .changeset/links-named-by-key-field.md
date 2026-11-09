---
'@adminium/engine': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
---

A link to a row is named by the `keyField` its table declares when that is a name a person reads: a proof's order reads "BR-2276" in its picker and chips, not the customer's name four times over. A key field that is an e-mail address, a phone number, anything personal or secret, or the last digits of a card (anything of four characters or fewer) names nothing, and the link keeps the column it was named by: a customer keyed by their e-mail is still called by their name. The reference picker keeps every row the server found for the words typed, so an order found by its number is listed even when its label is another column, and it asks the server once a query instead of again each time the answer is drawn. A record page's related list makes a new row with the form the table's own page creates with: its designed fields, a column the list leaves out (a proof's note), a choice in the app's words and a file column's upload.
