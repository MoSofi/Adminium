---
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The console's people screens and two switches a person keeps on their notification settings.

- **People and Teams.** The user list is called People, and has a Teams column (which teams each person is in, and which they lead). Teams is a page of its own beside it: a table of each team, its lead and its members, and a side sheet that holds a team's name, members and leads as a draft until "Save team".
- **Suspend asks "Hand their rows to…"**, as Remove does: the rows are listed by table, and the person who takes them is named in the same call that suspends, so a refused suspension moves nothing. "Nobody for now" leaves them where they are; a suspended person's row has "Hand on rows" for later.
- **Which rows a role reaches** speaks in the design's sentences ("Only rows of Deals where Owner is this person.") with the three choices "All rows · Their team's · Their own". A table reached through its parent is described like any other, not as "Follows".
- **Quiet hours and Summaries are two cards**, each with a switch the server keeps (`quietOn`, `summariesOn` on `/api/v1/me/notification-schedule`, migration 0059). Quiet hours switched off hold nothing and keep their hours; summaries switched off are "not me": no rule makes this person one, a summary already waiting is not sent, and their day and time are kept. A summary they ask for themselves is still sent. A write that leaves a switch out leaves it as it was. The cards say that quiet hours hold only the e-mail.
- The words of `/account` and `/account/preferences` now load with those screens, not with the first paint, which makes room for the rail's two new entries.
