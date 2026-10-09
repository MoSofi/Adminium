# Adminium skills

These skills teach a coding agent to build an app on [Adminium](https://adminium.dev). You say
what you want in plain words; the agent writes the app, checks it with Adminium, and tells you how
to open it.

They work with Claude Code, Codex, Cursor and any other agent that reads `SKILL.md` files.

**New to Adminium?** It is an open-source admin panel. Point it at a database and it gives you a
dashboard with lists, forms, search, roles and exports. An **app** adds a product on top of that:
its own tables, its own dashboard pages, and, when you want them, its own screens for your staff
and for your customers.

## Install

In the folder where you want to work, run:

```bash
npx skills add Adminiumjs/skills
```

It asks which skills to add and for which agent. Take all six: they are small, and they hand work
to each other. To make them available in every folder on your computer, add `--global`.

You need [Node.js](https://nodejs.org) 22.14 or later. You do not need a database to start: the
agent can make a sample one.

## How to use them

Open your agent in that folder and ask for what you want. You do not have to name a skill; the
agent opens the right one from your words.

> Create an Adminium app for a bike repair shop. Staff should see the repair jobs on a board, and
> customers should be able to send a repair request from a public page.

In Claude Code you can also start a skill yourself by typing `/adminium`.

A good request says three things:

- **What the business is.** "A bike repair shop", "a small hotel", "a yoga studio".
- **What you keep track of.** "Repair jobs, customers and spare parts."
- **Who uses it.** Only you in the dashboard, your staff on a tablet, or customers on a public page.

You can leave any of these out. The agent picks something sensible and says what it picked.

## What you get

- A **project folder** on your computer with the app in it, as plain files you can read and change.
- A **running app** to look at: the agent starts it and gives you the address.
- A short **report**: the tables and pages it made, the roles, exactly what a customer can see and
  send, and anything you asked for that Adminium cannot do.
- When you ask for it, **one file to install** the app on another Adminium.

The agent does not say "it works" on its own word. Adminium checks every change, and the agent
shows you the result.

## The six skills

### `adminium` — the starting point

Decides how much to build and which of the other skills to open. It keeps the agent from writing
code for things Adminium already does (lists, forms, filters, roles, exports, email templates,
automations), and it tells you plainly when a request needs no Adminium at all.

Try:

- "I run a dog grooming salon. What would an Adminium app for it look like?"
- "Build me an app to manage equipment loans at our school."
- "Do I need custom screens for this, or are dashboard pages enough?"

### `adminium-app` — tables, pages and roles

Builds the app itself: the tables that hold your data, the dashboard pages your team works in
(lists, forms, boards), the roles that say who may see and change what, and a few sample rows so
the app is not empty when you open it. It also packs the app into a file you can install elsewhere.

Try:

- "Create an app for a repair shop with jobs, customers and parts."
- "Add a 'priority' choice to jobs: low, normal, urgent."
- "Show the jobs as a board with the columns New, In progress and Done."
- "Add a Front desk role that can create jobs but not delete them."
- "Pack the app so I can install it on our company server."

### `adminium-surface` — screens for staff and for customers

Builds screens of your own, beyond the dashboard. A **staff** screen is for people who are signed
in, such as a kitchen display or a check-in desk on a tablet. A **customer** screen is public: a
booking form, an order page, a request form. Customers reach only what you allow, and the agent
reads that list back to you.

Try:

- "Add a public page where customers can book a table."
- "Make a tablet screen for the workshop that shows today's jobs with one tap to mark a job done."
- "Let a guest open their own booking from a link and change the date."

### `adminium-design` — making the screens look good

Makes those screens look like they were made for your business, not like a template: a clear first
screen, readable type, enough space, real words instead of filler, a simple logo, and pages that
work on a phone and with a keyboard. It comes with ten ready styles to start from: `clean`, `warm`,
`bold`, `calm`, `editorial`, `craft-market`, `night`, `bright-start`, `sharp-tech` and
`classic-hotel`.

It does not restyle the dashboard itself. That look belongs to Adminium.

Try:

- "Use the warm style for the booking page."
- "The customer page looks generic. Redesign it for a small family bakery."
- "Take the colours from this picture of our shop front." (attach the picture)

### `adminium-add-ons` — invoices, labels and other ready-made parts

An add-on is a ready-made part of Adminium, such as Invoices & Receipts, barcode labels, holiday
calendars or DHL shipping. This skill builds your app on top of an add-on instead of writing the
same thing again, so you get correct numbering, totals with tax and printed documents from the
start.

Try:

- "The repair shop app should send an invoice when a job is done."
- "Add quotes that can be turned into invoices."
- "Which add-ons are there, and would any of them help this app?"

### `adminium-project` — your own code around the app

For the cases where settings and pages are not enough: a dashboard page or card written in React, a
rule that runs on the server when a record is saved, or a button that runs your own code. It also
covers the project's settings, its databases and putting the project on a server. This is the most
technical of the six; most apps never need it.

Try:

- "Refuse a booking that overlaps another booking for the same room."
- "Add a 'Send reminder' button to each appointment."
- "Add a card to the dashboard that shows this week's revenue."
- "Help me put this project on our server with Docker."

## What they cannot do yet

- **Take payments** on a customer screen.
- **Publish an app** to the adminium.dev marketplace. An app you build installs from its folder or
  from its file.
- **Carry server code inside an app file.** Rules and buttons that run your own code stay in the
  project folder, so in that case the project folder is what you keep and deploy.

## Good to know

- The agent never asks for a password, a secret or an API key, and it does not open your `.env`
  file. If it does ask, say no.
- The apps it builds are in English.
- If something looks wrong, say so in your own words ("the booking form lets me pick a past
  date"). The agent changes the app and checks it again.

## Version

The skills are released together with Adminium, and `skills/VERSION` says which Adminium version
they are written for. If your Adminium is older, the agent tells you before it starts. To get the
newest skills, run `npx skills update`.

Each `references/` folder is produced from the Adminium documentation of that version. Do not edit
it by hand.

## Licence

AGPL-3.0-only, as Adminium is. The apps you build with the skills are yours.
