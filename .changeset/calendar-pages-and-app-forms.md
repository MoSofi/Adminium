---
'@adminium/server': patch
'@adminium/engine': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/i18n': patch
---

**Calendar pages plot by the right columns and open the page's own form; a few app fixes.**

- A calendar opens on the month today falls in, and its day list on today. It used to open on a
  fixed month from the demo data, or on the month most rows were in.
- An app can name a calendar's columns in its page's `config.calendar` (`start`, `end`, `title`,
  which may read through a foreign key such as `patient_id.name`, and `category`). Without it, a
  table with a booking rule is plotted by the booking's start instead of the first date in the
  table. On a page with a form, **Add event** and a click on an empty day open that form, with the
  day filled in.
- KPI cards on calendar, scheduler, board, queue, log and directory pages read money in the
  connection's currency, as dashboard cards already did.
- A link table with its own `id` and two foreign keys counts as a link between the two tables, so
  a chips field over it ("Visit types they do") reads and saves its rows. A form field may name
  the link table. A designed field that cannot be shown now says so in the form, and the install
  report and the server log name a field the install could not bind.
- A create replies with the row as stored, its totals and balance included. It used to reply
  before they were added up, so a new visit showed no balance.
- An app's email with no address on the row goes to the person the row links (or a first visit's
  own address), and the address is written into the row. A recipient whose language is not one of
  Adminium's gets the nearest template, with dates and times written their own way: `en-GB`
  reads "09:30".
