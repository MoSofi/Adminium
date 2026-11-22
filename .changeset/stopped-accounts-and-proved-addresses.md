---
'@adminium/server': patch
---

Three security fixes. A survey with "Link answers to names" off no longer keeps a time that matches an answer to its invitation, and the daily forms sweep removes that time from invitations already stored. Suspending or deleting someone now closes their open live connections at once, and a connection that was missed gets no further updates or subscriptions. Changing your own sign-in address now needs a link sent to the new address, opened while signed in, and the old address keeps working until then.
