---
title: The Lead finder add-on
description: Find companies by what they do and where in the registers of the UK, France and Norway, fill in a company's details from its register, OpenCorporates and its own website, and, if you switch it on, keep the people Hunter finds there and tell them at once.
---

From Adminium 0.3.66, add-ons 1.0.32.

Lead finder helps a sales team find companies to talk to, and keeps the companies it adds tidy. It
does three things:

- **Find companies** by what they do and where they are, in the public registers of the United
  Kingdom (Companies House), France and Norway, and add the ones you tick to your companies table.
- **Fill in a company's details** on its own record: its registered name, number, address, phone,
  what it does and a line about it, from its register, from OpenCorporates and from its own
  website. You see what would change, and only what you tick is written.
- **Keep the people who work there**, if you switch People on: Hunter finds their work addresses,
  you tick the ones to keep, and each one is told at once, by mail, where their details came from
  and how to object.

Adminium does the work. It reads a company's website itself, calls each source with that source's
key only, writes what you add or fill in **as you** (your role's limits apply), and sends the mail
that tells a found person. The add-on brings the sources, its tables and its screens.

## What it needs

- **Adminium 0.3.66 or newer.**
- **An app that declares a companies table**: the Sales CRM does from 0.2.9. Lead finder writes
  only the columns the app names for a company's details (see
  [For app developers](#for-app-developers)). With no such table it finds nothing to add to and
  says "No app on this database keeps companies."
- **A server that may call outside.** Lead finder is installed from the list adminium.dev offers
  ([The list from adminium.dev](/self-hosting/installing-add-ons/#the-list-from-adminiumdev)): it is
  not in the bundled set. A server with `ADMINIUM_NETWORK_FEATURES=off`, or a trial that keeps
  add-ons from calling out, can ask no source.
- **A key for each source that needs one**: Companies House (no charge), OpenCorporates and Hunter
  (both paid, on your own account). The registers of France and Norway and the website reader need
  none.

Install it from **Server settings → Add-ons**. The install screen lists every host each source may
contact before anything is installed. It makes four tables under the name `lead_finder_…` (people
found, fields' sources, its tell mails and its settings), a **Lead finder** page in the Library, and
two roles.

## What it never does

- **No Google Places.** The terms of Google Places forbid keeping the names and addresses Places returns, and
  keeping a company is the whole point. Companies are found in the registers instead.
- **No person from a website's text.** The website reader takes a company's own facts: its name,
  the description it gives of itself, its address, a shared address such as `info@` and its
  switchboard number. Never a named person's address, never a mobile number.
- **No change without a press.** Nothing is written until someone presses **Add** or **Fill in**.
  The one exception is the rule step **Fill in the company**: it fills only empty fields, from the
  registers that cost nothing ([below](#the-rule-step-fill-in-the-company)).
- **No business that said no.** A French unit that asked not to be contacted for sales, or that is
  only partly public, and a company OpenCorporates marks as restricted for marketing, are never
  added. You can still fill in the details of one you already have.
- **No sole trader while People is off.** A sole trader is a person, not a company (France's legal
  category 1000, Norway's `ENK`). With People off, Lead finder adds limited companies only.

## Its sources

| Source | What it gives | Key | Guide |
|---|---|---|---|
| Companies House (UK) | Companies by SIC code and place; one company by number or name | yours, no charge | [Companies House](/guides/add-ons/lead-finder-companies-house/) |
| Register of France | Units by NAF code and place; one unit by SIREN or name | none | [Register of France](/guides/add-ons/lead-finder-france/) |
| Register of Norway | Units by SN2025 code and municipality; one unit by number or name | none | [Register of Norway](/guides/add-ons/lead-finder-norway/) |
| OpenCorporates | One company's registered details, by number and country or by name | yours, paid | [OpenCorporates](/guides/add-ons/lead-finder-opencorporates/) |
| Hunter | The people at a company's domain, with their work addresses | yours, paid | [Hunter](/guides/add-ons/lead-finder-hunter/) |
| Website reader | A company's details from its own home page | none | [The website reader](/guides/add-ons/lead-finder-website/) |

Each source talks only to its own hosts, listed on its card. One source's key is never sent to
another source's host.

## Sources: keys, Check, limits

Open the **Lead finder** page and press **Sources**. Each source has a card: what it gives, the
hosts it may contact, its licence line, its key and a switch.

- **Paste the key** and press **Check**. Check saves the key, then asks the source whether it is
  good: "accepted", "refused", or "Couldn't reach". It spends none of the day's look-ups. The card
  then shows only the key's last four characters. **Replace** puts in a new one.
- **The switch** puts a source in use. A source with no key, or a refused one, waits until it has a
  good one.
- **The daily limit.** A paid source (OpenCorporates, Hunter) has one: 100 look-ups a day unless
  you set another, counted from midnight UTC. The card shows today's use against it. Each member
  of staff may use half of the day, so one person cannot spend it all. Every page of a search
  counts as a look-up.
- **The source's own pace.** Lead finder keeps to each source's published rate (Companies House:
  600 calls in five minutes; France: 7 a second; Hunter: 15 a second). A source that asks it to
  wait is left alone for as long as it says, and the screen says so.

Keys are kept encrypted on your server. Only someone with the **Lead finder settings manager**
role (or an admin) changes the cards; others with the page see them read-only.

## Finding companies

The **Lead finder** page, tab **Find companies**:

1. **What they do**: type a few words and pick from the register's own activity list (UK SIC
   2007, France's NAF, Norway's SN2025).
2. **Where**: a town or a postcode. In France, Paris, Lyon and Marseille are searched across all
   their arrondissements.
3. **Search in**: the sources that find companies and are switched on.

Results come a page at a time (**Show more**). Each row has the company's name, number, town,
website and what it does, and a chip when it is not new:

- **Already here**, with a link to the record;
- **Already here · kept by a colleague**: the record exists, but you may not open it. Lead finder
  decides "already here" across the whole install, not by what you can see, so a colleague's
  company is never added twice;
- **Asked not to be contacted for sales**: it cannot be added;
- **Sole trader: a person**: added only while People is on, and then only with their own address,
  so they can be told.

Tick the companies you want and press **Add {count} to {table}**, where the table is the one your
app declares (in the Sales CRM, Companies). Each is added as you, owned by you. If some are
refused, the screen says how many were added, and why the others were not. What a search found is held
for an hour; after that, search again.

"Already here" is decided by the company number, then the website's domain, then the name and the
town.

## Filling in a company's details

On a company's own record, **Fill in details** sits beside **Edit**. It shows only to someone who
may change the record. It opens a sheet from the side:

- **Website**: the record's own. **Read {host}** has the website reader read its home page.
- **Register**: pick one that is on. **Look up** asks it by the company number, or by the name.
  When several companies share the name, the sheet asks which one, and marks the one in the same
  town as the record.
- **Stop** ends a look-up; nothing is read after it.

The sheet then lists each detail found, with what the record holds **Now** and what was **Found**,
each with a tick. **Fill in ticked** or **Fill in all** writes them, as you. Nothing changes before
that.

Under each field filled, the record page shows a short note: "From Companies House · 12 Mar 2027",
say. The note stays only while the value is the one filled in: once someone edits the field, it
goes. Any reader of the record sees the notes.

If a colleague changed a field after the sheet showed it, the fill is refused as a whole ("Address
was changed by Hana Brodsky after you looked. Look up again."), so nobody's work is overwritten.

With People on and a Hunter key saved, the sheet also has **People at {domain}**: see
[Hunter](/guides/add-ons/lead-finder-hunter/) and [People and the law](/guides/add-ons/lead-finder-people/).

## The rule step "Fill in the company"

While Lead finder is installed, a rule may use the step **Fill in the company** (see
[What a step can do](/guides/automations/#what-a-step-can-do)). It is held tightly, because a rule
runs with nobody watching, often on a row a stranger made (a form's enquiry):

- it asks only the registers that cost nothing (Companies House, France, Norway): never
  OpenCorporates, never Hunter, never a website. Nothing a stranger typed ever becomes an address
  your server fetches;
- it looks a company up by its number, else by its name and town, as the record holds them;
- it fills **only empty fields**: nothing a person typed is changed;
- it takes the one company a register finds. Several, or none, is a line in the run log, and
  nothing is written;
- it has its own budget: up to 50 look-ups a day for rules, on each register.

## People found

The second tab, **People found**, lists the people Lead finder kept, with where and when they were
found, whether they may be e-mailed, and where telling them stands (Tell by, Told on, Couldn't tell,
Objected). **Send again** re-sends a tell mail that failed. Everything about People is in
[People and the law](/guides/add-ons/lead-finder-people/).

## Roles

| Role | May |
|---|---|
| Company finder | open the Lead finder page; read the people found, the fields' sources and the tell mails; send a failed tell mail again |
| Lead finder settings manager | open the page; change the sources and the People card |

Adding and filling in write to your app's tables as the person pressing the button, so they also
need their app role's right to create or change companies (and contacts, for people).

## What it keeps

- **People found**: for each person kept, the row in your people table, the source, when they were
  found, why they are kept, by when they must be told and when they were, and the pages Hunter
  saw their address on. Adminium alone writes it.
- **Fields' sources**: for each field a source filled on a record, which source and when, with a
  fingerprint of the value: what the notes under fields are drawn from.
- **Tell mails**: the mail that told each found person.
- **Settings**: whether people are kept, why (a sentence per language) and for how long.

The companies and people themselves are rows of your app's own tables.

## Sample data

The Sales CRM's sample (0.2.9) brings a few made-up found companies and the people Hunter found at
them, in each state of being told. Their addresses end in `.example`, so nothing is ever sent to
them.

## For app developers

An app says which table holds companies, and where a found company's details go, in its manifest's
`people` list: an entry of kind `companies` with a `lead` object. Every key is optional; each names
a column of the table.

```json
{
  "table": "companies",
  "kind": "companies",
  "name": "name",
  "lead": {
    "number": "company_number",
    "website": "website",
    "phone": "phone",
    "address": {
      "lines": "address_lines",
      "town": "town",
      "region": "region",
      "postalCode": "postal_code",
      "country": "country"
    },
    "activity": "sector",
    "about": "about",
    "owner": "account_owner_id"
  }
}
```

- Each detail is a text column with a width (`maxLength`): a value found is cut to it.
- `country` is a column exactly 2 wide: it takes the ISO 3166-1 two-letter code only.
- `owner` is a column that holds a staff member (`rules.staff`): it is set to whoever adds the
  company.
- Each detail goes in a column of its own.

`people.lead` is a word from Adminium 0.3.66, so the app's floor must be 0.3.66 or newer. Found
people go into the app's people table (the entry of kind `people` linked to the companies by its
`company` column), so that table needs a name and a company for each person.

An add-on that brings sources of its own provides the `lead-source` contract (version 1) and lists
its sources under `addOn.sources`, each with the hosts it may reach and the key it needs.
