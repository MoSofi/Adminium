<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § When a session was ended; do not edit -->

# Guests, their details and their own links: When a session was ended

A session ended by **Sign out everywhere** or by **Delete my details** answers its next request as
no session, with the header `x-adminium-session-ended` set to `elsewhere` or `forgotten`. It is
said once, only to the holder of that session's token: after that the token is simply unknown,
as a lapsed one is. The client drops the session, calls `onSessionEnded(reason)`, and
`sessionEnded()` answers the reason, so the page can say "You were signed out on another device"
rather than seem to forget them.

A session found by details a person typed (a phone, an address) lasts only while their record
still holds what they typed, and a session raised by an emailed code only while the record still
holds the address the code went to. The record is asked again on every request, whatever changed
it: when the desk changes one of those details, the session answers as no session (without the
header), and the person finds themselves again.
