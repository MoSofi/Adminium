<!-- produced from apps/docs/src/content/docs/guides/add-ons/landing-pages.md § Funnels; do not edit -->

# The Landing pages add-on: Funnels

The **Funnels** tab lists the funnels. **New funnel** asks for a name and up to 8 steps, in order:
your live pages and live forms.

A funnel shows each step with its count and the share of the step before, over a date range: this
month, last month, the last 7 or 30 days, or the last 12 months.

- A **page** step shows the page's views.
- A **form** step shows two counts: the form opened, and the form sent. When the step before is a
  page, both are counted on that page. When it is not, "opened" is the form's own page being
  opened, and "sent" is every send.
- A page that was deleted, or a form that is no longer live, shows as removed and counts nothing.
  A page that is off keeps the views it had.

These are views, not people, with known bots left out. When counting is off, a funnel has nothing
to show. How views are counted, and how long they are kept, is set on the server (see
[Visitor counting](https://docs.adminium.dev/guides/privacy/visitor-counting/)).

**What happens after** links one of your rules to the funnel, such as the rule that sends a
brochure when the form is sent. The funnel then shows the rule's name and steps, and **Open rule**.
Linking a rule changes nothing in the rule. Only someone who manages rules can link one or open
it; others see the rule that is linked.

Deleting a funnel leaves its pages, forms and counts as they are.
