---
name: adminium-design
description: Design the screens of an Adminium app so they look made for the business — the public customer side and the staff side. Covers the first screen, hierarchy, type, spacing, colour, pictures, icons, the logo, real words and the access basics, and carries a set of ready styles (`styles/`). Use whenever a screen people see is written or restyled. Not for dashboard pages, which are Adminium's own.
license: AGPL-3.0-only
---

# Designing an app's screens

A screen is finished when a stranger can tell in three seconds whose page it is, what it offers
and what to do next. Wiring that works is half the job.

This skill is for the **staff** and **customer** sides of an app. Dashboard pages are drawn by
Adminium: do not restyle them.

## Start from a style and a brief

1. Take one style from `styles/` (the person may have picked one; otherwise the one that suits the
   business). A style gives the colours, the two fonts, the corners and how a page is laid out.
2. Write a short brief before any screen: `apps/<key>/design.md`. Six lines are enough:
   who the page is for, the feeling in three words, the style and what you change in it (colours
   from a reference picture, if there is one), the sections of the first page in order, what the
   pictures show, the logo's idea.
3. Build to the brief. Later changes read the brief first, so the page stays one design.

## The first screen

- A header: the logo and name at the start, three to five links, one button for the main action.
- A hero that says what the business is in one line a customer would say, a second line with the
  concrete promise (what, where, when), the main button, and a real picture or a strong colour
  band. Never "Welcome" alone, never "What can we do for you?".
- Then what is on offer (with prices when there are prices), then why to trust it (a few lines
  about the place, opening hours, a quote), then the form or the way to get in touch, then a
  footer with the address, hours and contact.
- One main action per screen, in the accent colour. Everything else is quieter.

## Hierarchy and type

- Two fonts at most: one for headings, one for text. Use the theme's (`var(--font-display)`,
  `var(--font-body)`).
- Three or four sizes on a screen, clearly apart: a large heading, section titles, text, small
  notes. Use the theme's steps (`--text-sm` … `--text-4xl`); do not invent sizes in between.
- Text lines of 45 to 75 characters. Body text 16 px or more. Headings tight (line height 1.1 to
  1.2), text open (1.5 to 1.7).
- Make the important thing big, dark and first. Make the unimportant small and muted, do not
  delete it.

## Space

- Space says what belongs together: little space inside a group, more between groups, most
  between sections. Use the theme's steps (`--space-1` … `--space-8`).
- Sections on a public page are far apart (64 px or more on a wide screen). Cramped pages look
  cheap; this is the most common fault.
- Align to one grid. Edges that almost line up look like mistakes.

## Colour

- All colours come from the theme: background, surface, text, muted, line, accent, second accent,
  band. Never write a colour value in a screen.
- The accent is for the main action and a few marks. If everything is accent, nothing is.
- One dark or coloured band on a page (a quote, the booking section) gives it rhythm.
- Text must be easy to read on its background (contrast 4.5:1 or more; the theme's pairs are).

## Pictures

- A page about food, rooms, people or things needs pictures of them. Ask for them with the
  picture tool, or use what the person attached. Never put another site's picture address in a
  page on your own: it shows as an empty frame.
- Give every picture a fixed shape (`aspect-ratio`) and `object-fit: cover`, so a grid stays even.
- Every picture has `alt` text that says what it shows; a purely decorative one has `alt=""`.
- With no picture: a colour tile with the item's first letter or an icon, in the theme's colours.
  It must look chosen, not missing.

## Icons and the logo

- Icons come from the icon set (`lucide-react`), one size and one stroke on a screen. Without the
  set, draw a small inline SVG. **Never an emoji as an icon.**
- Every public side has a logo: `assets/logo.svg`, a simple mark (a letter in a shape, or one
  drawn symbol of the trade) beside the name in the heading font. It sits in the header and is the
  page's icon.

## Words

- Write what this business would write: its dishes, its services, its street, its hours. No
  "Lorem ipsum", no "Item 1", no "Your tagline here".
- Buttons say what happens: "Book a table", "Send the order". Not "Submit".
- After sending, say what happens next ("We will confirm by email within the hour").
- An empty list says so, and what to do.

## Every screen, every time

- Works on a phone first: one column, buttons at least 44 px high, nothing wider than the screen.
- Every input has a label that stays visible. Errors are said in words beside the field.
- Focus is visible on everything that can be clicked. Everything works with the keyboard.
- Respect `prefers-reduced-motion`: movement is small, short and never needed to understand.
- Light and dark both look right: use the theme's values and they do.

## What generic "AI design" looks like, so you avoid it

- A purple-to-blue gradient hero with centred white text.
- Three equal cards with an emoji, a two-word title and one vague sentence.
- Every corner very round, every box with the same soft shadow.
- Headings like "Welcome to our website" and "Our services".
- A page that is all one size, one weight and one grey.

## For staff screens

Staff use the screen all day: put the work first, not the brand. A plain header with the name,
the list or board they work from, clear status marks, large touch targets on a tablet. Use the
style's colours and fonts, and skip the hero, the pictures and the bands.

## The styles

`styles/<key>/SKILL.md` describes each; `theme.json` holds its values. See `styles/INDEX.md`.
