<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § Forms become limited public creates; do not edit -->

# A website template as a working app: Forms become limited public creates

Each form writes to a table of its own: the contact form to `messages`, the newsletter form to
`subscribers`. Its entry in `access.json` is a `POST` with `requires`, `"humanCheck": true` and the
`anonymous` limits, as [limits on a stranger's create](https://docs.adminium.dev/guides/apps/public-access/#limits-on-a-strangers-create)
says, and `plainText` on the name columns.

- Give every input the `name` of its column, and `required` where the table requires the column.
  `adminium app check` says which columns "will be required": a form that sends without one is
  refused.
- Keep the template's labels and placeholders. Add an `aria-label` where an input has neither.
- After sending, say what happens next under the button, in the template's own text styles. On
  a refusal, say a sentence of your own for its `code`.
- A form that asks for something the app will not keep (a password for an account that is never
  made) is left out, and is a line in the plan. Never keep a field whose answer is thrown away.
