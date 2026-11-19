---
title: "Lead finder: OpenCorporates"
description: Fill in a company's registered details from OpenCorporates, by its number and country or by its name, with your own paid OpenCorporates key. It fills in only; it does not search by activity.
---

OpenCorporates gathers company registers from many countries in one place. Lead finder uses it to
**fill in** one company's registered details, on its record: useful above all for a company whose
own register Lead finder does not search. It does **not** find companies by what they do: **Search in** never lists it.

- **Host:** `api.opencorporates.com`, and no other.
- **Key:** yours, and **paid**. The keys OpenCorporates gives at no charge are not for a
  business's use: a business needs a paid self-serve key from opencorporates.com.
- **Credit:** its card says **Powered by OpenCorporates**, and each field it fills in carries the
  note "From OpenCorporates" on the record.
- **Daily limit:** 100 look-ups a day unless you set another (see below).

:::caution
Details found with OpenCorporates may need finding again if your subscription ends. Its terms
govern what you may keep once you stop paying: check them before you rely on what it filled in.
:::

## Getting the key

1. On opencorporates.com, choose a paid self-serve API account for your business, and sign in.
2. Copy your API token from your account's API page.

## Putting it in

1. Open **Lead finder** in the Library and press **Sources**.
2. On the **OpenCorporates** card, paste the token and press **Check**. Check asks OpenCorporates
   for your account's status, which spends no look-up. The card says "accepted" or "refused", and
   then shows only the last four characters.
3. Set the **Daily limit**: press **Edit**, type the most look-ups Lead finder may make in a day, and
   **Save**. The card shows today's use against it. Each member of staff may use half of the day.
4. Turn the card's switch on.

OpenCorporates takes its key as part of the address it is called at. Adminium never writes such an
address down: what it logs of a call is the host and the path, never the key.

## What it fills in

**Fill in details** with the register **OpenCorporates** looks a company up:

- by its **number and country**, when the record has both (OpenCorporates needs the country to know
  which register the number is from); or
- by its **name**, else. When several companies share the name, the sheet asks which one, and marks
  those in the same town as the record.

It can fill in the registered name, the number, the registered address (with the country as its
two-letter code) and the activity.

## Restricted for marketing

Where a register says a company's details may not be used for marketing, OpenCorporates marks it
`restricted_for_marketing`. Lead finder never adds such a company and never keeps a person at it.
Filling in the facts of one you already have still works.

## Never by a rule

The rule step **Fill in the company** never asks OpenCorporates: rules use only the registers that
cost nothing, so nobody's paid look-ups are spent while nobody is watching.
