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

A new app starts with nothing in it but its name and a role. The Designer writes the tables, the
pages and the role's grants. It is kept on course in four ways:

- A file that would not read as JSON is refused when it is written, not at the next check.
- If the Designer stops with errors left in the check, it is told them and goes on.
- If it finishes with a table nobody can open (no page, or no grant), it is told once.
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

The build is not a sandbox: it runs as you, and can read what you can. So a source file that
names a path outside the app's own folder (an import of `../../../.env`, say) stops the build
before it starts, and says which file. The Designer does not read back what a build left. A copy
is taken only from the repositories of publishers Adminium vouches for.

**The licence.** The apps are AGPL-3.0, and a copy keeps that licence. If people use your copy over
a network (your customers, on your site), the licence asks you to offer them the source of your
version, changes included.

## Look at it

- **Preview** shows the app as a person with the app's own role sees it: the dashboard pages, and
  the staff and customer screens when the app has them, at desktop, tablet and phone width.
- **Architecture** draws what the server applied: who uses the app, what they use, the tables and
  how they link, the emails and add-ons. Anything written to the folder and not applied yet is
  marked.
- The version menu lists every version. Going back to one makes a new version on top, so nothing
  is lost.

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

Each turn and each session has a ceiling, so a model that goes round in circles stops by itself.
They are settings of the install:

| Setting | Default | What it limits |
|---|---|---|
| `designer.maxSteps` | 60 | Model calls in one turn |
| `designer.turnTokens` | 1,500,000 | Tokens one turn may use, counting what is sent again at each step |
| `designer.sessionTokens` | 15,000,000 | Tokens one session may use in all |

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
