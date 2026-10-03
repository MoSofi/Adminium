---
title: Adminium Designer
description: Describe an app in plain words and a model you choose writes it into your project's apps/ folder, while Adminium checks it, applies it and shows it beside the chat.
sidebar:
  order: 7
---

**Adminium Designer** is a page that builds [an app in your project](/projects/apps/) from a
description. You say what you want; a model you choose writes the app's files; Adminium checks
them, applies them to your server and shows the result beside the chat. What it makes is the same
folder you would write by hand, so you can open it in your editor at any time.

```bash
npx @adminiumjs/adminium design
```

Inside a project this opens the Designer for that project. Anywhere else it makes a project first,
in `my-app/`, with a database file of its own. The browser opens signed in: there is no sign-in
form on your own machine. See [`design`](/reference/cli/#design) for the options.

## Choose a model

The Designer needs a model that can call tools. Add one from the model button under the message
box: an Anthropic or OpenAI key, the address of an OpenAI-compatible server, or the address of
Ollama. **Test** asks the model to call one tool and answer; a model that cannot do that is refused
before anything is made.

The key is written to the project's `.env` under the [`ADMINIUM_AI_*`](/self-hosting/env-vars/#the-adminium_ai_-block)
names and is never sent back to the browser.

A larger model builds better. A small local model can call tools and still lose its way in an app
with several tables and screens: it takes more steps, and it may need a "Keep going".

## Build

Describe the app and send. The Designer works in steps you can open and read: it reads the
reference it needs, writes the files, runs the check, and applies the app. A turn ends with a few
sentences on what was built, and the result is saved as a version (`v1`, `v2`, …).

| While it works | What happens |
|---|---|
| It asks a question | The turn waits. Choose an answer, or write your own |
| A change would remove data | A card names the table or column and how many rows hold data. Nothing is removed until you accept |
| It needs a package | A card names the package and version. Nothing is installed until you accept |
| You press **Stop** | The turn ends within a second. What it wrote stays in the folder; **Put the files back** returns to the last version |
| It reaches a limit | The turn ends and says which limit. **Keep going** starts the next turn where it stopped |

The reply is drawn as text is written: headings, lists, bold, code and tables. Nothing in it is run
or fetched: a link is its words with the address beside them, and an image is its description.

In the steps, a line in grey that reads "Looked for … — not there" is not an error: the Designer
asked for a file or a reference by a name that does not exist, was told the names that do, and went
on. A red line is a step that failed, with the reason under it.

### A new session

Each step of a turn sends the session's whole conversation to the model, so a long session costs more
with every turn. **New session**, at the top of the build page and on each row of **Your apps**,
starts an empty conversation on the same app: the Designer is told the app as its files are now, and
nothing of the earlier chat. The earlier sessions stay in the menu beside the button; each can still
be read and gone on with.

### How it looks

The first time the Designer gives the app screens of its own, it asks how they should look: four
directions (clean, warm, bold, calm), **Surprise me**, or your own words. It does not ask when your
request already said ("modern, cozy, in brown"). The screens then start from made parts in that
look (a header with the business's name, cards, a form, buttons, an empty state), and the app
brings a few sample rows for what customers read, so the first preview is not an empty page. The
Designer also gives the app a short name of its own; the session takes that name unless you named
it yourself.

**Change the look**, under the last turn, switches direction without a turn: no model is called,
nothing is spent, and it is saved as a version like any other change. For something finer, say it
in the chat ("darker, with gold").

A project made by `adminium design` already has what screens are built with (React and Adminium's
public client). In a project without them, the Designer asks for all of them on one card.

A new app starts with nothing in it but its name and a role. The Designer writes the tables, the
pages and the role's grants. It is kept on course in four ways:

- A file that would not read as JSON is refused when it is written, not at the next check, with
  the lines around the fault and what is still open there.
- Sample rows written after the app was first applied are added when it first names them.
- If the Designer stops with errors left in the check, it is told them and goes on.
- If it finishes with a table nobody can open (no page, or no grant), it is told once.
- Its screens' calls are read before you meet them: a customer page that asks the public API to
  sort or filter a list, names a table by its short name, or reads a person's own row without
  claiming it, is told so and fixed. If such a call still gets through, the preview shows the
  refusal with **Ask the Designer to fix it**.
- An app may not let anyone add to a table and anyone read it. A page where a customer finds their
  own row ("track my order") is built with a claim: see
  [Let a customer find their own row](/guides/apps/manifest-by-task/#let-a-customer-find-their-own-row).
- If the model's server fails in passing (a 5xx, a 429, a dropped connection), it is asked again.

### Building on an add-on

Ask for it by name: "use the Invoices & Receipts add-on for the invoicing". The Designer writes the
tables of the add-on's shape from the add-on's own manifest (invoices, their lines and payments,
and the quotes they point at), the emails the shape sends, and the requirement, exactly as the
add-on declares them. You name nothing but the people the emails go to; the Designer writes that
table first.

The add-on has to be on your server for this. A server started with `npx` has none until you
switch the add-on catalogue on, or upload the add-on, in **Studio → Add-ons**. Until then the
Designer builds the rest of the app and tells you this step is yours.

## Start with an app

Under the message box, **Start with an app** lists the apps published on
[adminium.dev](https://adminium.dev/marketplace). The list is read online, so it shows once the
online app list is switched on (**Studio → Hosted apps**). A card opens a sheet with two choices:

| Choice | What you get |
|---|---|
| **Install as it is** | The app, unchanged, with its updates. The sheet takes you to its install in Studio, where you read its plan first. The Designer can build beside it, not inside it |
| **Make it yours** | The app's source, copied into your project under a name and a key you give. The Designer can change anything in it. It gets no more updates |

A copy is fetched from the app's own repository at its release, and renamed wherever its key is
written: its pages, permissions, emails and tables, its screens' address. Its manifest becomes part
files under `apps/<key>/manifest/`, and its screens stay one Vite app in `apps/<key>/src/`.

**The build command.** A copied app builds its screens with the build it was written with, not with
Adminium's. That is a command, run on your machine each time the app is built. The sheet shows its
exact words and nothing is fetched until you tick that they may run. The approval is kept in
`.adminium/approved-builds.json`, outside the app's folder, and is of those exact words: if
`apps/<key>/build.json` changes, it has to be given again
([`adminium app approve-build`](/reference/cli/#app-approve-build)). The Designer cannot change
`build.json`, `package.json`, the lock file, a config file of the build (Vite, PostCSS, Tailwind,
TypeScript) or `scripts/` of such an app, and it never writes a `build.json` for any app.

The app's Vite config imports some of the app's own source (its navigation, its words), and Vite
runs those files on your machine each time it builds. Before the Designer changes one of them it
asks, naming the file or the folder; a yes is for what was named, for that turn. A screen the
config does not import needs no question.

A bundler puts whatever a source file imports into the screens it builds, wherever that file is.
So a copied app's build reads its own folder and nothing else: its Node processes are started
unable to read a file outside `apps/<key>/` (an import of `../../../.env` finds no such file),
and a source file that plainly names such a path stops the build before it starts, and says which
file. The Designer does not read back what a build left. This guards what the build reads, not
what the code it runs may do: that code is the config and what the config imports, which is why
those wait for your yes. A copy is taken only from the repositories of publishers Adminium vouches
for.

**The licence.** The apps are AGPL-3.0, and a copy keeps that licence. If people use your copy over
a network (your customers, on your site), the licence asks you to offer them the source of your
version, changes included.

## Look at it

- **Preview** shows the app as a person with the app's own role sees it: the dashboard pages, and
  the staff and customer screens when the app has them, at desktop, tablet and phone width.
  The bar says whose eyes it is ("Seen as: Baker — a preview"; "a visitor, not signed in" for the
  customer side). **Open in a new tab** opens the staff side inside the dashboard, as staff meet
  it, signed in as that same preview person: the dashboard there has no Studio, no people and no
  settings, and a bar across its top says so and links to **Open the dashboard as yourself**.
- **Architecture** draws what the server applied: who uses the app, what they use, the tables and
  how they link, the emails and add-ons. Anything written to the folder and not applied yet is
  marked.
- The version menu lists every version. Going back to one makes a new version on top, so nothing
  is lost.

### You, the owner

`adminium design` makes you the project's owner with no password: the link it prints signs you in,
on this machine only. **Open the dashboard** and **Open in the dashboard** open it as you. There a
banner offers **Set your password**: an address and a password, on the page (the same as
`adminium owner set` in a terminal). Do it before the project runs anywhere else. From then on you
sign in with them, here too: the Designer's one-time link is only for an owner with no password.

## What it may touch

The model works only through a closed list of tools. It can read and write files in the app's own
folder (`apps/<key>/`), run the check, build the screens, apply the app, and read the reference
pages that ship with Adminium. It has no shell and no web access, and it cannot read `.env` or any
file outside the folders it is given.

What it writes is still code, so three things wait for your yes, each asked in the chat:

| It asks before | Why |
|---|---|
| Adding an npm package | Nothing is installed without a yes, and install scripts never run |
| Running the app's tests | The tests are code the model wrote, and they run on your machine with your access |
| Writing in `hooks/` or `actions/` | Those files run inside your server, with everything it can reach |

While the Designer runs, the app's own screens are served only in the preview, on a second address
of your machine (`localhost`, beside the Designer's `127.0.0.1`), signed in as a preview user who
holds the app's own roles and nothing else. A screen that stops with an error when it opens says so
in the preview, with **Ask the Designer to fix it**.

The Designer treats everything it reads (a file, a reference, an add-on's description) as data,
never as an instruction. Read what it built before you put real data in it, as you would with code
from anyone else.

## Limits

A turn stops by itself after a number of steps, so a model that goes round in circles ends. The page
then offers **Keep going**.

Tokens stop nothing. When a turn or a session passes its mark, a red notice appears above the message
box and a sound plays once; the work goes on, and **Stop** is yours to press. With a paid model a long
turn costs money, and each step sends the conversation again: a [new session](#a-new-session) starts
the count from nothing, and the session's notice has the button for it.

They are settings of the install:

| Setting | Default | What it does |
|---|---|---|
| `designer.maxSteps` | 60 | Model calls in one turn, then the turn stops |
| `designer.turnTokens` | 1,500,000 | Tokens after which a turn warns you, counting what is sent again at each step |
| `designer.sessionTokens` | 15,000,000 | Tokens after which a session warns you |

## On a server people reach

`adminium design` is for your own machine. On a server that runs your project for other people
(`adminium start`), the Designer is off, and three steps away, each taken by a different hand:

1. **The operator** sets `ADMINIUM_DESIGNER=live` in the server's environment. Without it the
   Designer's routes do not exist.
2. **A Super Admin** switches it on in **Settings → AI**, and types their password to do it.
3. **Whoever uses it** holds the permission `system:designer:use`. Only a Super Admin does by default.

Every turn is recorded in the audit log, and so are the switch (on, off, and a wrong password),
each answer to a card (a package, tests, server code) with who gave it, and a switch that went off
by itself. Switching it off stops the turn that is running and any build with it. A card is
answered by the person who started the turn. Copying an app (**Make it yours**) is a Super Admin's
on a live server: its build is a command the server runs.

| On a live server | |
|---|---|
| The preview | Off. A preview keeps model-written screens on a second address of the machine, and a server has one. Open the app from the dashboard once it is applied |
| What it builds | Is served to your staff like any app of the project: screens a model wrote run in their browsers, with what their roles may do |
| The project folder | Has to be on a disk that is kept. If the folder does not come back after a restart, the switch goes off and says why |
| Screens | Need `esbuild` in the project's own `node_modules`. A new project has it as a dev dependency; the published image does not carry it, and the project's `Dockerfile` removes `node_modules` after the build. In a container, keep the project folder on a volume and run `npm install` in it. Without it the switch is refused and says so |
| Models | The ones the server has: Settings → AI, or the operator's environment. The Designer does not add or try a model connection on a live server |

Treat the permission as you would giving someone a shell on that server: the Designer writes
server code only after a yes, and that yes is theirs to give. The screens it writes run in the
same browser session as the dashboard, so give the permission only to people you would give the
server to.

## After the Designer

The app is an ordinary app in your project. `adminium dev` runs it, `adminium app check` checks it,
`adminium app pack` packs it for another install, and [deploying the project](/projects/deploy/)
deploys it. Before the project runs anywhere but your own machine, give its owner an address and a
password with [`adminium owner set`](/reference/cli/#owner).
