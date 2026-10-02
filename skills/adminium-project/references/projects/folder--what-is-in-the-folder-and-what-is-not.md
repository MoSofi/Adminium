<!-- produced from apps/docs/src/content/docs/projects/folder.md § What is in the folder, and what is not; do not edit -->

# The project folder: What is in the folder, and what is not

| In the folder | In Adminium's database |
|---|---|
| Pages and dashboards (`pages/`) | Users, roles and grants |
| Schema customizations (`schema/`) | Settings, including email and branding |
| Your hooks, actions, pages and widgets | Saved views and personal dashboard layouts |
| The config, the Dockerfile, `.env.example` | Email and report templates, automations |
| Option lists (`lists/`) | Installed apps and add-ons, the audit log, jobs |

The split is deliberate: the folder holds what a developer reviews in a pull
request, and the database holds what people change while using the admin.
[`adminium export-zip`](https://docs.adminium.dev/self-hosting/export-zip/) still carries the whole
instance when you need to move one.
