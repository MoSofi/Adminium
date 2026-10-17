<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — Quiet hours and urgent; do not edit -->

# Manifest spec: Automations — Quiet hours and urgent

### Quiet hours and urgent

Each person may set, under their own notification settings, quiet hours for each weekday on their
own clock, and the day and time their summaries are sent. A notice that arrives in quiet hours is
in the app at once and its email waits for the hours to end; so does a rule's email to a person.
`"urgent": true` on a notice is not held (a change to today's day sheet), and neither is a kind
of notice the person marked "always tell me". A person who chose no time zone is read on the
business's. Where one window ends as the next begins (Friday evening into a Saturday that is
quiet all day), what is held waits for the end of the last of them.

Two switches are kept beside these (`quietOn` and `summariesOn` on
`/api/v1/me/notification-schedule`). Quiet hours switched off hold nothing, and keep their hours
for when they are switched on again. Summaries switched off are "not me": no rule's `digest` step
makes this person one, whichever of its roles they hold, and one already waiting for its hour is
not sent; the day and time are kept. A summary the person asks for themselves
(`POST /api/v1/me/summaries/{ruleId}/send`) is still sent. A write that leaves either switch out
leaves it as it was.
