<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — UNIQUE_VIOLATION; do not edit -->

# Error codes: Staff and API-key write codes — UNIQUE_VIOLATION

### UNIQUE_VIOLATION

`details.columns` lists the columns the broken unique rule keeps unique together, so a form can
mark each; it is left out when the rule is not the table's own. `constraint` is the database's
name for the rule, or `null`. On the data routes `detail` is always `null`: Postgres's own sentence
spells out the other row's values, masked and hidden columns included.
