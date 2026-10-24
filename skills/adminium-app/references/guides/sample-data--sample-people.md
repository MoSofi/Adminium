<!-- produced from apps/docs/src/content/docs/guides/apps/sample-data.md § Sample people; do not edit -->

# Sample data: Sample people

An app whose rows belong to people (a deal has an owner, a visit has a crew) brings its sample
people with it. Adding the sample data makes them as staff members marked **Sample person** on
the Team page. A sample person cannot sign in, is never sent mail, and cannot be renamed,
suspended, deleted or given another role by hand. They hold the app's own roles and sit in the
sample's teams, so a manager's page shows a team and a rep's page shows that rep's rows.

Removing the sample data removes them and their teams. A sample person one of your own records
still names stays until that record names somebody else; adding the sample data again takes
that person back instead of making a second one. If you already have a team called "Sales", the
sample's team is made as "Sales (sample)" and yours is left alone.

### Rules that run on sample records

Adding the sample runs no automations, but the sample's records are real rows afterwards: signing
off a sample job runs the app's rule for a signed-off job. A rule never hands a row to somebody who
cannot sign in, with one exception: a rule running on a **sample** record may name a sample
person (the aftercare call of a sample job goes to the sample rep who sold it). On one of your own
records a sample person is nobody, and the rule's log says so.

What such a rule makes is sample data too. Adminium adds those records to its list of sample
records, so **Remove sample data** takes them with the rest, and the sample record they belong to
goes with them. A rule-made record you have since written something of your own under (a note on
that aftercare call) is kept, like any sample record your records use. A record a rule made from
one of your own records is never on the list. Adminium 0.3.35.
