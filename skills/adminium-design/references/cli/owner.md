<!-- produced from apps/docs/src/content/docs/reference/cli.md § `owner`; do not edit -->

# CLI reference: `owner`

```
adminium owner set [--email <address>] [--password-stdin]
```

Gives the owner [`design`](https://docs.adminium.dev/reference/cli/#design) made an email address and a password. Asks for both; with
`--password-stdin` the password is the first line of standard input. Run it inside the project.
It works once: after that the owner changes their password in the dashboard like anyone else.

[`start`](https://docs.adminium.dev/reference/cli/#start) on a project whose owner has no password yet says so and names this command.
