---
title: The Landing pages add-on
description: Pages for offers and events, each at its own address, with one of your forms on it if you like. Making a page, drafting it with Milo, publishing, addresses and homes, sharing previews, languages, funnels, Forms' "Go to a landing page" ending and the roles.
---

Needs Adminium 0.3.65 and add-ons 1.0.31. It comes with Adminium from the release after 0.3.65,
as Forms & surveys and Live chat do. On 0.3.65 itself, add it from the online catalogue on
**Add-ons**.

Landing pages makes pages for an offer or an event, each at its own address, with one of your
forms on it if you like. A **funnel** puts a page, its form and its thanks page in order and shows
how many views each step gets.

Adminium draws every live page for your visitors, writes its title and sharing preview, serves its
pictures and counts its views. No code of the add-on runs for a visitor, and nothing is fetched
from anywhere else.

Install it from **Add-ons**. It attaches to every app and works with none. It makes two tables
under the name `pages_…` (the pages and the funnels), two roles, and one page in the Library,
**Landing pages**: the pages as cards or a list, with their status and this month's views, and a
**Funnels** tab. A form on a page comes from a forms add-on installed beside it, such as Forms &
surveys.

## Making a page

**New page** makes a draft and opens the editor. A page is built from **sections**, at most 60,
each added with **Add a section**:

| Section | What it holds |
|---|---|
| Hero | a heading and a line of text, with a picture and a button if you like |
| Heading | a title for a part of the page |
| Text | a paragraph or two; a blank line starts a new paragraph |
| Picture | one picture, full width |
| Button | a link that stands out |
| Columns | two or three side by side, each with a heading, text and a picture |
| Features | up to 12 short points, each with an icon |
| Quote | a customer's words and who said them |
| Questions and answers | up to 20 questions that open one by one |
| Spacer | empty room between sections, small, medium or large |
| Form | one of your live forms, filled in on the page |

All text is plain: no formatting and no links inside it. A button goes to an address on the web
(a whole address that starts with `https`), to another landing page, or to the form on this page.

Click any part of the page to edit it in the inspector. **Undo**, **Redo** and **Preview** are in
the top bar, or under **More** on a narrow screen; Preview shows the page as visitors see it. The editor saves as you go.

### Pictures

A picture is a PNG, JPEG, WebP or GIF of up to 5 MB. **Upload** one, or **Choose from Files**. The
page keeps its own copy, so changing or deleting the file in Files leaves the page as it is.

Every picture needs a description, read aloud to people who cannot see it, or the tick **It's only
decoration**. A page with a picture that has neither is not published.

Visitors are shown a picture only while the page is live. When the page is switched off, its
pictures stop too.

### The Form block

The Form block shows one of your **live** forms. If no form is live yet, publish one first. The
block says where the form goes after sending: its thank-you words, an address, or another landing
page.

A page has one language, and the form is shown in that language. If the form has no version in
the page's language, visitors do not see it on the page, and the editor says so: add that language
to the form. If the form is closed later, visitors do not see it either.

A form on a page is the form itself: its own checks, limits and answers, the same as on its own
page.

## Drafting with Milo

**Draft with Milo** asks what the page is for, and Milo drafts the sections. It uses your
business's name and e-mail address and your live forms. It leaves out quotes from customers, links to
other sites, pictures and anything it could not name for sure; the editor lists what it left out.
Add those by hand if you want them.

Milo needs the assistant permission, an AI service set up on the server, and your own daily
allowance (see [The page assistant](/guides/llm-assist/milo/)).

Every section Milo writes carries a mark, **Written by Milo**. A page cannot be published while a
mark is left: Adminium refuses it, whatever sends the change. Read each section and change what is
wrong. **It looks right**, on a section, takes its mark off. The band over the page has **Looks
right**, which takes every mark off at once, and **Undo all**, which puts the page back as it was
before the draft.

## Publishing

**Publish** checks the page first and lists what to fix: an empty page, a field too long, a
picture without a description, a link that is not `https`, a mark left by Milo, an address that is
not allowed or is taken. Nothing is published until all of it is fixed.

Publishing keeps a copy of the page as it is. Visitors see that copy. Your changes after it stay in the
editor until you press **Update** (**Publish the changes**).

**It needs the privacy notice.** Every public page links to it at the bottom, so Publish stays off
until the business name and the privacy notice address are set (see
[The privacy notice](/guides/email/privacy/#the-privacy-notice-and-the-postal-address)).

**Visitors can't reach it yet.** A page can be published while visitors cannot reach this server.
The editor then says "Published, but visitors can't reach it yet", with a note above the page
saying why:

- the server has no public https address (the **Address in email links**);
- public pages are switched off (`ADMINIUM_NETWORK_FEATURES`);
- the server runs on this computer only (the desktop app);
- the server is behind a proxy it does not trust: set `ADMINIUM_TRUST_PROXY=on` (see
  [Behind a reverse proxy](/self-hosting/reverse-proxy/)).

The page shows as soon as the note is gone.

## The page's address

A live page is at `/x/pages/<address>` on this server's public address, for example
`https://example.com/x/pages/open-day`. You set the address in **Page settings**. It holds
lower-case letters, digits and dashes, up to 80 characters. Words the addresses themselves use, and
words a sign-in, account or payment page would use (`api`, `login`, `account`, `password`,
`billing` and others), are not allowed, so a page can never pass for the server's own sign-in. Two
pages may not share an address.

Changing the address of a live page moves it: the old address shows "This page isn't available."

## Your own domain and a home page

A page also answers on every host you map to forms and pages. On **Studio → Hosted apps**, the
**Domains** card attaches a host; choose **Forms and pages** for it, and pick its **Home page**, a
live form or page. That host then serves your forms and pages, and its `/` opens the home page.
It serves no part of the dashboard. DNS and your proxy are set up as for an app's own domain (see
[An app surface on its own domain](/self-hosting/app-domains/)).

From a page's settings, **Make this the home of …** makes it the home of a mapped host. It needs the
right to change the domains.

## Sharing and search engines

In **Page settings**:

- **Title**, up to 70 characters: the browser tab and a shared link show it.
- **Description**, up to 200 characters: the line under the title in a shared link and in search
  results.
- **Sharing picture**, best at 1200 × 630. With none, a shared link shows the title and the
  description only.

Adminium writes these into the page itself, so a chat app or a social site shows them when the
link is pasted.

A page has one address that search engines are told about: on the host it is the home of; else on
the first host mapped to forms and pages, by name; else on the public address. Search engines may
index a live page only there. On any other host the page asks not to be indexed and names that
address. A preview, and a page on a trial server, are never indexed.

## Switching a page off

**Show this page**, in Page settings, switches a live page off and on. While it is off, visitors
see "This page isn't available." Its views stay, and so do its pictures, for when it is live again. If the page is the home of a
host, the editor warns you first: visitors there would find nothing.

## Languages

A page has one language. Visitors get the page in that language, and its form in the same one. For
another language, **Make a copy** of the page (in **More**, or in Page settings), choose its
language, and write it in that language. The copy is a draft with an address of its own.

## Funnels

The **Funnels** tab lists the funnels. **New funnel** asks for a name and up to 8 steps, in order:
your live pages and live forms.

A funnel shows each step with its count and the share of the step before, over a date range: this
month, last month, the last 7 or 30 days, or the last 12 months.

- A **page** step shows the page's views.
- A **form** step shows two counts: the form opened, and the form sent. When the step before is a
  page, both are counted on that page. When it is not, "opened" is the form's own page being
  opened, and "sent" is every send.
- A page that was deleted, or a form that is no longer live, shows as removed and counts nothing.
  A page that is off keeps the views it had.

These are views, not people, with known bots left out. When counting is off, a funnel has nothing
to show. How views are counted, and how long they are kept, is set on the server (see
[Visitor counting](/guides/privacy/visitor-counting/)).

**What happens after** links one of your rules to the funnel, such as the rule that sends a
brochure when the form is sent. The funnel then shows the rule's name and steps, and **Open rule**.
Linking a rule changes nothing in the rule. Only someone who manages rules can link one or open
it; others see the rule that is linked.

Deleting a funnel leaves its pages, forms and counts as they are.

## A form that ends on a landing page

In Forms & surveys (add-ons 1.0.31), a form's **After sending** has **Go to a landing page**. Pick
a live page: after sending, the visitor is taken to it, on the same host the form was on. The form
is not published while the page it goes to is not live.

If the page is switched off later, visitors who send the form see the form's own thank-you words
instead. The page's Form block says so in the editor.

## Roles

| Role | May |
|---|---|
| Landing pages editor | make, change, publish, switch off and delete pages and funnels |
| Landing pages reader | read pages and funnels, and change nothing |

Give these roles the whole tables. A role held to some of the pages is refused the preview and the
counts, because those answer for every page.

## Sample data

**Add sample data** adds two pages and a funnel: "Showroom open day", which is **live**, a German
spring offer as a draft, and the "Open day" funnel. The live sample page can be opened by anybody
with its address until you remove the sample or switch the page off.
