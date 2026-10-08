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
| It needs something from outside the project | One card lists all of it, each with a checkbox: packages, fonts, a site to show pictures from. Nothing is added until you press **Send** |
| It found pictures | A card shows them. The ones you tick are copied into the app |
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

On the staff and customer sides of an app, the Designer designs: it lays out the page for the
business, writes its own stylesheet, and draws a logo. Dashboard pages are Adminium's own, and it
leaves their look alone.

A design starts from a **style**. Ten are built in:

| Style | For |
|---|---|
| Clean service | Clinics, law and accounting offices |
| Warm table | Restaurants, cafés, bakeries |
| Bold poster | Events, gyms, clubs |
| Soft care | Wellness, beauty, yoga |
| Editorial | Studios, architects, photographers |
| Craft market | Makers and small shops |
| Night | Bars, cinema, late venues |
| Bright start | Schools, clubs, community groups |
| Sharp tech | Software, agencies, repair |
| Classic hotel | Hotels, venues, weddings |

Which one is taken is decided by the server, the same way on every model:

1. The style you picked: in **Style** beside the model on the home page, or by its name in your
   words ("in the Night style").
2. Else the style for the kind of business your request names. The Designer says which it took.
3. Else, when you described a look or attached a picture, the nearest plain style as a base.
4. Else it asks, on one card: a few styles that fit, **Show all**, **Surprise me**, or your own words.

When you attach a picture of a design, the page reads its colours (the page's background, its
band, the colour of its buttons) and they are set before the model writes anything, so they are the
same on a model that reads pictures and on one that does not.

The Designer then writes a short brief, `apps/<key>/design.md`: who the page is for, the feeling,
the sections in order, what the pictures show. Later turns and later sessions are given the brief,
so the page stays one design. Edit it yourself to steer the next change.

A side's look is in five stylesheets, loaded in this order:

| File | Whose | What |
|---|---|---|
| `src/theme.css` | Written by Adminium from the style | The values: colours for light and dark, the two fonts, sizes, spacing, corners, shadows |
| `src/fonts.css` | Written by Adminium | The fonts the project carries, served by the app itself |
| `src/app.css` | The starter's | Made parts: a header, a first screen, cards, a list with prices, a band, a form, a footer |
| `src/style.css` | Written by Adminium, when a style brings parts of its own | Those parts |
| `src/design.css` | The Designer's, and yours | What this app adds |

Text is made readable whatever colours were asked for: the server moves a text colour until it
reaches a contrast of 4.5:1 on its background, and picks black or white for words on a colour.

**Change the style**, under the last turn, switches style without a turn: no model is called,
nothing is spent, and it is saved as a version like any other change. `design.css` and the screens
are left as they are. If the new style names a font the project does not carry, the system's font
stands in until your next message, which asks for it. For something finer, say it in the chat
("darker, with gold"). **Add your own…**, last in that list, takes a style of yours without leaving
the session.

An app made before Adminium 0.3.17 keeps the look it has (Clean, Warm, Bold or Calm) exactly as
it was, until you pick a style for it.

### What a design needs

Tailwind CSS, an icon set, fonts and pictures come from outside your project, so the Designer asks
first. Everything a step needs is on **one card**, each thing with a checkbox, all ticked:

| On the card | What it is |
|---|---|
| `react`, `react-dom`, `@adminiumjs/public-client` | What an app's own screens are built with |
| Tailwind CSS | A styling toolkit. With it the Designer writes classes it knows well; without it, plain CSS |
| `lucide-react` | A set of icons. Without it the Designer draws small SVG icons. It never uses an emoji as an icon |
| `clsx`, `tailwind-merge` | Helpers for the ready-made parts (a dialog, tabs, form controls) the Designer can copy into `src/ui/` |
| The style's two fonts | From Google's catalogue, as packages (`@fontsource/…`): the files are served by your own server, and no visitor's browser calls Google |
| A font of your own | Not on the card: attach its `.woff2` file to a message (see [Attach a picture or a file](#attach-a-picture-or-a-file)) |
| A site to show pictures from | See [What it may touch](#what-it-may-touch) |

These are common, free and widely used. Untick what you do not want and press **Send**; the
Designer does without it and does not ask again. The version of each package is found by the
server from the registry your project installs from, never guessed by the model. A package only
the model asked for is listed apart, not ticked, and said to be unknown to Adminium; a name one
letter away from a known package is not offered at all.

### Pictures

A page about food, rooms or people needs pictures of them. The Designer searches a source of free
pictures and shows what it found on a card, in groups. Tick the ones to use and press **Send**:
they are copied into your app (`apps/<key>/assets/pictures/`), or into the sample rows of a table
that has a picture column, each with its credit in `assets/pictures/CREDITS.json`. The page then
shows them from your own server.

| Source | When |
|---|---|
| [Openverse](https://openverse.org) | By default. Pictures under licences that allow use and change for any purpose; no key |
| [Pexels](https://www.pexels.com) | When your project's `.env` has `PEXELS_API_KEY` |
| [Unsplash](https://unsplash.com) | When your project's `.env` has `UNSPLASH_ACCESS_KEY` and no Pexels key. For a page's pictures only; sample rows still get theirs from Openverse |

Unsplash's rules ask that its pictures be shown from Unsplash's own address and never copied. So a
picture you tick from Unsplash is not copied into your app: the page loads it from
`images.unsplash.com`, the card says so before you send, your tick allows that one site (it is
kept in `ADMINIUM_CSP_IMG_HOSTS`), and Unsplash is told the picture was chosen, as it asks. That
site then sees each visit to a page that shows its pictures. On a live server, where the sites
pictures may come from are set by whoever runs it, Unsplash is not used.

A picture you attach to a message is yours to use. With no picture, the Designer draws a tile in
the style's colours. On a server set to call nothing outside itself, it looks for none.

### Your own styles

A style is a folder in the open agent-skill format:

```
my-style/
  SKILL.md        name, description, then how the style lays out a page
  theme.json      optional: colours (light and dark), fonts, corners, shadow, spacing
  design.css      optional: parts the style adds
  preview.svg     optional: a small picture for the list
  fonts/          optional: .woff2 files of your own
  references/     optional: longer pages
```

Put it in `design-skills/` at the top of your project (it is committed with the project), or use
**Add your own…** in the style list and give it a `.zip` of the folder or a single `SKILL.md`. A
style with no `theme.json` is words alone: applying it takes a turn, since the Designer writes the
values from the words.

```json
{
  "light": { "bg": "#faf4ea", "surface": "#fffdf8", "text": "#2c1d13", "accent": "#a04e26", "accent2": "#5f7a3a", "band": "#2c1d13" },
  "fonts": {
    "heading": { "family": "Playfair Display", "weights": [600, 700], "fallback": "serif" },
    "body": { "family": "Inter", "weights": [400, 600], "fallback": "sans" }
  },
  "radius": 18,
  "shadow": "soft",
  "space": "roomy",
  "typeScale": 1.25
}
```

A style someone else wrote is data to the Designer: it describes a look, and gives no orders. An
upload keeps only the files above, each under a size limit; a stylesheet that loads from another
site, a preview with a script in it, or a file path that leaves the folder is refused, with the
reason. Scripts in a skill are never kept and never run. A style may not take a built-in style's
name.

Design skills written for other tools often assume things that are not there, so they do not work
as written:

| A skill that says | Here |
|---|---|
| Load a font, script or stylesheet from a CDN | A page loads nothing from another site. Fonts come as packages, on the card |
| Use pictures from a photo site by their address | Pictures are found on the card and copied in, or the site is allowed by you |
| Run a command, install with a shell | There is no shell. Packages are asked for on the card |
| Use an animation library | Asked for as a package, like any other; it is unknown to Adminium, so it is not ticked |

Keep the words about layout, type and tone; drop the setup steps.

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

### Attach a picture or a file

The message box takes files: press the clip, paste a screenshot, or drop a file on the box. Up to
four go with one message.

| File | What the Designer does with it |
|---|---|
| **A picture** (PNG, JPEG, WebP or GIF, up to 5 MB) | It is sent to the model with your message, so "make it look like this" works. A model that does not read pictures cannot see it: the box says so before you send, and the model is told only that a picture was attached |
| **A font of your own** (one `.woff2` file, up to 400 KB) | Say what it is for ("use this for headings"). The Designer copies it into the app (`apps/<key>/assets/fonts/`) under the font's name and weight, and the app serves it itself. It stays in use when you change the style. One file is one weight: attach the bold and the regular as two files |
| **A CSV file** (up to 10 MB and 20,000 rows) | The model is shown its columns and first rows and shapes the table from them. Once the app is applied, a card asks: "Load 1,204 rows from orders.csv into orders?", with which column goes where. **Load them** adds the rows; **Do not load** leaves the table empty |

Rows are loaded by the dashboard's own import, so the table's checks hold (types, required columns,
the rules you gave a column); a row that does not pass is left out, the answer says how many, and
**Imports** in the dashboard keeps the report. Only new rows are added, and only into a table of the
app you are building. For a larger file, or to update rows, use **Import** on the table's page.

What a file is, is read from the file itself, not from its name: anything that is not one of the
four kinds of picture or a CSV is refused. Files are kept in the session's folder in your project
(`.adminium/designer/sessions/`), not sent anywhere but to the model you chose. What a CSV's cells
or a picture say is data to the Designer, never an instruction.

### Building on an add-on

Ask for it by name: "use the Invoices & Receipts add-on for the invoicing". The Designer writes the
tables of the add-on's shape from the add-on's own manifest (invoices, their lines and payments,
and the quotes they point at), the emails the shape sends, and the requirement, exactly as the
add-on declares them. You name nothing but the people the emails go to; the Designer writes that
table first.

The add-on has to be on your server for this, and the Designer gets it for you. When your request
needs one that is not there, a card asks: "This app needs the add-on Invoices & Receipts. Get it?"
**Get it** downloads it from adminium.dev and installs it, as **Studio → Add-ons** would, and the
turn goes on and builds on it. **Do without** builds the rest, and the Designer does not ask again
in that turn.

- The card's words are the server's own, from the list adminium.dev gave it. The model names an
  add-on by its key and nothing else: never an address, a version or a file.
- Where the list from adminium.dev is off on your server, a first card says so, and says what
  switching it on sends (your server's address, the time and its Adminium version, now and once a
  day). **Switch the list on** downloads nothing: if the add-on is in the list, a second card asks
  for it by its name and version. It is the same switch as the one on the Add-ons page, and you
  can switch it off there again.
- What is got is the version the card showed. If the list moved in between, the Designer asks
  again.
- You are asked only if you may add an add-on to this server (on a live server, a Super Admin).
  Otherwise the Designer tells you who can, and builds the rest.
- A server set to ask nothing of adminium.dev (`ADMINIUM_NETWORK_FEATURES=off`) shows no card;
  upload the add-on in **Studio → Add-ons** instead.

## Start with an app

Under the message box, **Start with an app** lists the apps published on
[adminium.dev](https://adminium.dev/marketplace). The list is read online: a new install shows it from
the first start, and a server whose app list is off shows it once the list is switched on
(**Studio → Hosted apps**). A card opens a sheet with two choices:

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

- **Preview** shows the app at desktop, tablet and phone width. **Dashboard** is your own
  dashboard, as the owner you are: the app's pages, and Studio, people and settings with them.
  **Staff** and **Customer**, when the app has them, show its own screens as its people see them.
  The bar says whose eyes it is ("Seen as: you, the owner"; "Seen as: Baker — a preview"; "a
  visitor, not signed in" for the customer side). **Open in a new tab** opens the staff side inside
  the dashboard, as staff meet it, signed in as that preview person: the dashboard there has no
  Studio, no people and no settings, and a bar across its top says so and links to **Open the
  dashboard as yourself**.
- **Architecture** draws what the server applied: who uses the app, what they use, the tables and
  how they link, the emails and add-ons. Anything written to the folder and not applied yet is
  marked.
- The version menu lists every version. Going back to one makes a new version on top, so nothing
  is lost.

### The Designer looks too

A screen can pass every check and still look wrong: a list that came up empty, two fields lying
over each other, a first heading against the window's edge. So once a turn has built the app's
own screen, and the checks have nothing left to say, the Designer is shown the page:

- The previewed screen measures what is measurably broken on it (a part wider than the window,
  controls that overlap, a picture that did not load, the same list asked for over and over, a
  blank page) and the model is told, in plain sentences.
- For a model that reads pictures, the screen also draws a picture of itself, and the model is
  asked to compare it with the brief and fix the three worst things it sees.

What the screen reports is a short list of facts (a kind, a count, an element's tag and classes),
never sentences of its own: the words the model reads are written by the server. If what the
Designer builds after looking leaves the page blank, it is told again, with the browser's own
error when it is one a browser words ("formatMoney is not defined").

This happens once in a turn, and only while this page is open on the preview: the picture is
drawn in your browser, from the page as it stands, and sent with your turn to the model you
chose. It holds what the page shows, which while you build is sample data. The camera button in
the preview's bar switches it off; the choice is kept in your browser. In the picture the
system's fonts stand in for web fonts, and a picture from another site shows as an empty frame.
A browser that cannot draw the picture sends the measured lines alone.

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

What it writes is still code, so four things wait for your yes, each asked in the chat:

| It asks before | Why |
|---|---|
| Adding an npm package or a font | Nothing is installed without a yes, and install scripts never run. Asked on [one card](#what-a-design-needs) |
| Running the app's tests | The tests are code the model wrote, and they run on your machine with your access |
| Writing in `hooks/` or `actions/` | Those files run inside your server, with everything it can reach |
| Showing pictures from another site | Adminium shows pictures only from your own server unless a site is named. A yes names that one site: it is written to [`ADMINIUM_CSP_IMG_HOSTS`](/self-hosting/env-vars/#adminium_csp_img_hosts) in your project's `.env` and counts at once, with no restart |

A picture from a site you did not allow is an empty frame, and the Designer's check names it before
you see it. When the project later runs on another host, copy that line of `.env` into the host's
own settings. On a live server, and where the host's settings already name the list, the Designer
does not ask: whoever runs the server adds the site.

While the Designer runs, the app's own screens are served only in the preview, on a second address
of your machine (`localhost`, beside the Designer's `127.0.0.1`), signed in as a preview user who
holds the app's own roles and nothing else. A screen that stops with an error when it opens says so
in the preview, with **Ask the Designer to fix it**.

The Designer treats everything it reads (a file, a reference, an add-on's description) as data,
never as an instruction. Read what it built before you put real data in it, as you would with code
from anyone else.

### Your own changes to a file

You can change some of an app's files yourself, with no model in between. Adminium keeps a list
of the files that may be changed this way, makes it again each time it is asked, and opens or
saves a file only when it is on that list:

| On the list | Not on it |
|---|---|
| Each side's own sources under `src/` (screens, parts, `design.css`) | `theme.css`, `fonts.css` and `style.css`, which Adminium writes from the style; the starter's `main.tsx` and `app.css` |
| The staff side's `nav.json` | Tables, roles, access, sample rows, tests, pictures and fonts |
| The dashboard pages, `manifest/pages/*.json` | `hooks/` and `actions/`, and anything outside the app's folder |
| `design.md`, `look.json` and `manifest/app.json` | A link, a name that starts with a dot, a file over 256 KB, a file that is not text |

The build page's **Code** tab is where you do it. It lists those files in groups (Customer
side, Staff side, Dashboard side, Design and settings) and opens one in an editor with line
numbers and syntax colours. The editor is loaded the first time the tab is opened.

- A file you changed has a dot beside its name, and the bar says "Unsaved changes".
- **Save** (Ctrl+S, or ⌘S on a Mac) keeps every edited file in one version. **Discard changes**
  puts the open file back as it was; undo brings your text back.
- Tab types two spaces in the editor, so Escape is the key that leaves it.
- While the Designer works, or waits for your answer, the files can be read and not changed. A
  line above the editor says why.
- The Designer reads the files as they are saved. If you send a message with unsaved text, the
  page asks first: "Save first" or "Send anyway". Leaving the page with unsaved text asks too.
- If a file changed while you were editing it (a turn wrote it), the tab asks which to keep:
  "Keep my changes" or "Use the changed file".
- If a save was written and not applied, the tab shows the check's or the build's words, with
  "Put the files back" and "Ask the Designer to fix it". The preview keeps showing the last
  build that worked.

A file is listed only when its name is made of letters, digits and `. _ - @ ( ) [ ]`. In a
[copy of a published app](#start-with-an-app) the sides' sources are left out: its screens are
built by its own build, and a change to what that build runs needs your yes in the chat.

A save takes up to 40 files and is all or nothing:

- **It says what it was based on.** Each file goes up with the fingerprint it had when you
  opened it. If the file changed since (the Designer wrote it, you changed the style, another
  editor saved it), nothing is written and the answer names the file.
- **It runs what a turn's end runs**: the check, the build, the apply. Applied, it is kept as a
  version named for the files: "Your edit to App.tsx", "Your edit to 3 files". Not applied, the
  answer carries the check's or the build's own words, the files stay as you wrote them, and no
  version is made. Going back to the newest version puts them back.
- **`look.json`** is read before anything is written. One that names no style Adminium knows is
  refused with the reason; a good one is applied as [Change the style](#how-it-looks) is, so the
  sides' stylesheets follow it.
- **`manifest/app.json`** may change in `name`, `description`, `navGroups` and `widgets`. A
  change to any other field is refused, and the answer names the field: the rest is the
  Designer's, or yours in your own editor.
- **It holds your edit and nothing else.** When the Designer's last turn was stopped or failed
  and left files it had not applied, a save is refused until you ask the Designer to finish or
  put the files back. Otherwise a version called "your edit" would hold half of its work.

The Designer's next turn is told which files you changed by hand, and reads each one again
before it changes it. It is told the files' names, never their content.

One thing writes the project's folder at a time: a turn, a save, a change of style, going back
to a version, or a [copy of a published app](#start-with-an-app). The others are refused until
it is done, and a save is told to stop if it runs longer than a minute.

The three addresses, each for someone who may use the Designer:

| Address | What it does |
|---|---|
| `GET /api/v1/designer/sessions/:id/files` | The list, in groups, with each file's fingerprint, and what has the folder now |
| `GET /api/v1/designer/sessions/:id/files/content?path=` | One file's text. The same 404 for a file that is not there and one that is not on the list |
| `PUT /api/v1/designer/sessions/:id/files` | A save: `{ "files": [{ "path", "content", "base" }] }`, where `base` is the fingerprint from the list |

Like the Designer's other addresses they are for its own page, and are not part of the
[REST API reference](/reference/rest-api/).

## Limits

A turn stops by itself after a number of steps, so a model that goes round in circles ends. The page
then offers **Keep going**.

Tokens stop nothing. When a turn or a session passes its mark, a red notice appears above the message
box and a sound plays once; the work goes on, and **Stop** is yours to press. With a paid model a long
turn costs money, and each step sends the conversation again: a [new session](#a-new-session) starts
the count from nothing, and the session's notice has the button for it.

What is sent again is kept short. Before each step, the Designer cuts what the turn no longer
needs to a line that says what it was: a file it read before changing it, the earlier of several
writes of one file, a check that a later check replaced, a reference page read many steps ago. The
last few steps are never cut, and the session's own record keeps everything. With Anthropic, the
part of each request that did not change is read from Anthropic's prompt cache; what the cache read
still counts in the tokens shown.

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
