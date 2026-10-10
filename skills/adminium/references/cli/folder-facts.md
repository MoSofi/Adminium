<!-- produced from apps/docs/src/content/docs/reference/cli.md § `folder-facts`; do not edit -->

# CLI reference: `folder-facts`

```
adminium folder-facts
```

Prints, as one line of JSON, what the project folder holds: whether `.env` has the key, whether
the data is there, which Adminium last changed it, and the names of the people, API keys and
public keys in it. Nothing of the folder is built, imported or changed, so it is safe to run on
a folder someone sent you before you decide to open it.

You rarely run this yourself. The Adminium desktop app runs it before it opens a project.
