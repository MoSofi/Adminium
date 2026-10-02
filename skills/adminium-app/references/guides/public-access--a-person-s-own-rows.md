<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § A person's own rows; do not edit -->

# An app's public access: A person's own rows

A key has one **identity**: the table guests claim, such as patients. Other entries can belong to
it. Each reaches only the rows whose column holds the found person's key: their visits, their
place on a waiting list, their own patient record. A session found through another identity
reaches none of them. Without a session they answer `404`, as if there were nothing there.

- **Creating one.** A signed-in create fills the column with the person's key itself; the page
  cannot set it. An entry may also let a create go through with **no** session, such as a first
  visit by someone not yet on file. The app can then name columns that a signed-in create
  empties, such as the name and contact details typed for a first visit, because the person is
  already on file.
- **Two levels.** A session found by details is at the **lookup** level. It reaches the
  **verified** level once the person confirms a code sent to their own address
  ([below](https://docs.adminium.dev/guides/apps/public-access/#the-emailed-code)). An entry that needs verified refuses a lookup session with `403`
  and the code `PUBLIC_CLAIM_LEVEL`, and the page asks for the code. On such an entry, a verified
  session also sees its own values in columns marked personal; every other public read keeps them
  masked.
- **Sensitive entries.** An app marks an identity **sensitive** when knowing a person's details
  should not be enough to see their records, as in a clinic. Every entry it opens must then say
  whether it is sensitive too. A sensitive one needs a verified session, and one that is not must
  give a reason. The install refuses an app that leaves either out.
- **What may change.** A guest may change only their own rows, only the columns listed, only to
  the values listed (cancel, never mark a visit seen), and only while the row is in the state the
  app names (booked, and still ahead). The state can also be a column still empty, so a value is
  written once (a signature, "I've paid"), or a date that is today or later, or already past (an
  offer still in date may be accepted; one out of date may be asked about again). Any other row
  is `404` to the change, though it still lists.
- **Not too early.** The state can include a time window: a check-in no more than an hour before
  the visit, or any time after it. A change asked for earlier is refused `409` with the code
  `PUBLIC_TOO_EARLY`, and the reply names the row's time and when the window opens, even when the
  entry does not otherwise show that time. That is said only for the person's own row, in a state
  the change would otherwise be taken from; every other miss is still `404`.
- **Only so many open.** An entry can cap how many open rows one person holds, for example two
  upcoming visits. The next signed-in create is refused `409` with the code
  `PUBLIC_LIMIT_REACHED`, and the page offers the phone instead.
- **Rank.** A create can answer where the new row stands, such as "you are 3rd on the waiting
  list". The reply carries `rank`, the number of matching rows ordered at or before it, and
  nothing else about them.
