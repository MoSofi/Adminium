<!-- produced from apps/docs/src/content/docs/projects/index.md; do not edit -->

# Create a project

A **project** is a folder you own: your generated pages as files, your own
buttons, save hooks and table cells beside them, and one config file that says
which databases the admin is built from. You open it in an editor, commit it to
git, and deploy it like any other Node app.

Nothing about how Adminium works changes. It still reads your schema and draws
the admin from it — the pages are settings, not generated code. A project just
keeps those settings in your repository instead of only in Adminium's database.

You do not need one. [`adminium try`](https://docs.adminium.dev/projects/#try-it-without-a-project), the
[Docker image](https://docs.adminium.dev/getting-started/docker/) and the
[desktop app](https://docs.adminium.dev/desktop/) keep Adminium entirely in its own database, which is
the right choice if nobody is going to write code. Use a project when you want
to review changes in a pull request, run the same admin on a laptop and on a
server, or add code of your own.
