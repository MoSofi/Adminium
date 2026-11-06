---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

Each workspace can have its own mail sender: a name, a From address, a reply-to and a postal address. Mail about a record (a rule's email, an app's outbox, a document, a campaign to a table's people, an invoice's pay link, a form or booking confirmation) goes from the sender of its database's workspace, and a database in several workspaces uses the first one. Marketing mail prints that sender's postal address, and is signed for its domain when the server holds that domain's key. Sign-in links, invitations and other system mail still go from the server's sender. A template can name who it always goes as with Send as. The From address must be one the server's mail settings can already send for, and the form lists which. The do-not-email list stays one for the whole server: someone who unsubscribes from one business hears from none.
