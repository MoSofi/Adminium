<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § What the install shows first; do not edit -->

# An app's public access: What the install shows first

When an app has customer screens, the table check has a **Public access** card: "The app's
customer screens need to:", then one line per thing they will do, for example:

- **Read** *table*, or **Add to** *table*, or **Change** *table*;
- **Read free or full times of** *table*;
- **Look up their own** *table* **by** *fields*;
- **Add to** *table*, **and get a confirmation email**.

**Allow this public access** is ticked by default, because the customer screens do not work
without it. Untick it and the app installs with no keys and no endpoints. **You can narrow it
later on the API keys page.**

Allowing it needs the **Manage API keys** permission as well. Someone without it sees the box
switched off and the line "Only someone who may manage API keys can allow it, so the app installs
without it."

The card also warns about anything that would stop the keys working, though the install still
goes ahead:

| Warning | What to do |
|---|---|
| The public API is switched off | Turn on **Public API** in **Workspace settings** |
| The allowed origins do not include "self" | Add `self` to `ADMINIUM_PUBLIC_API_ORIGINS` and restart ([below](https://docs.adminium.dev/guides/apps/public-access/#origins)) |
| This database has no time zone set | Set the connection's time zone; dates and times need it |
| Email is not set up | Set up email, or guests get no confirmation, no reminder and no emailed code |
