---
title: "Lead finder: Companies House (UK)"
description: Find UK companies by SIC code and place, and fill in one company's registered details by its number or name, with a Companies House key that costs nothing.
---

Companies House is the register of companies in the United Kingdom. Lead finder uses its public
data API to **find companies** by what they do (their SIC 2007 code) and where their registered
office is, and to **fill in** one company's registered details: its name, number, office address
and activity.

- **Host:** `api.company-information.service.gov.uk`, and no other.
- **Key:** yours. A key costs nothing.
- **Licence:** the data is under the Open Government Licence. The card says so.
- **Pace:** Companies House allows 600 calls in five minutes. Lead finder keeps under it; if it is
  told to wait, it waits, and the screen says how long.
- **Daily limit:** none of Lead finder's own, as the source costs nothing. A rule's step still has
  its own budget of 50 look-ups a day.

## Getting the key

1. Create an account on the Companies House developer site,
   `developer.company-information.service.gov.uk`, and sign in.
2. Register an application there, for the live environment.
3. Create a key for it of the **REST** kind. (Not a stream key, and not one for a browser.)
4. Copy the key itself.

## Putting it in

1. Open **Lead finder** in the Library and press **Sources**.
2. On the **Companies House (UK)** card, paste the key and press **Check**. The card says
   "Companies House accepted the key", with the time, and shows only its last four characters.
3. Turn the card's switch on.

"Refused" means Companies House does not know the key: check that you copied the REST key whole.
"Couldn't reach" means your server could not get an answer; try again later.

## What it finds

**Find companies** with **Search in: Companies House** searches live companies by:

- **What they do**: pick an activity from the SIC 2007 list. A broad heading searches every code
  under it.
- **Where**: a town or a postcode, matched against the registered office.

A company's row links to its page on the register's own site. A UK company number is eight
characters, such as `98412736` (made up).

## What it fills in

On a company's record, **Fill in details** with the register **Companies House** looks the company
up by its number, or by its name when the record has no number. It can fill in the registered
name, the number, the office address (lines, town, region, postcode, and `GB` as the country) and
the activity, as the first SIC code's description.

Companies House lists a company's officers. Lead finder never keeps an officer as a person, and
never reads their birth date, nationality or address.
