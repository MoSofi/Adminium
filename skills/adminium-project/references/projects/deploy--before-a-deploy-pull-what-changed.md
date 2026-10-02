<!-- produced from apps/docs/src/content/docs/projects/deploy.md § Before a deploy, pull what changed; do not edit -->

# Deploy a project: Before a deploy, pull what changed

A deploy never overwrites a page somebody edited on the server — it keeps the
server's copy and shows a conflict instead. So the habit worth having is:

```bash
npm run pull -- --from https://admin.example.com
git diff                     # review, merge if you had changed the same page
git commit -am "pull server edits"
```

Then deploy. Once the deployed files match, the flags clear by themselves.
Details: [Pull and check](https://docs.adminium.dev/projects/pull-and-check/).
