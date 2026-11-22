---
'@adminium/server': patch
---

Four security fixes. A survey with "Link answers to names" off no longer keeps a time that matches an answer to its invitation, and the daily forms sweep removes that time from invitations already stored. Suspending or deleting someone now closes their open live connections at once, and a connection that was missed gets no further updates or subscriptions. Suspending or deleting someone also revokes every API key they made, and reactivating them does not bring the keys back, so a shared integration running on one of those keys needs a new key. Changing your own sign-in address now needs a link sent to the new address, opened while signed in, and the old address keeps working until then.
