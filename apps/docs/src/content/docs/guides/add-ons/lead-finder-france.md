---
title: "Lead finder: Register of France"
description: Find French businesses by NAF code and town, and fill in one unit's registered details by its SIREN or name, through the French state's open company search. No key.
---

The Register of France is the French state's open company search (the "API Recherche
d'entreprises"). Lead finder uses it to **find businesses** by what they do (their NAF rév. 2 code)
and where, and to **fill in** one unit's registered details by its SIREN or its name.

- **Hosts:** `recherche-entreprises.api.gouv.fr`, and `geo.api.gouv.fr`, the state's open town
  service, which turns a town you type into the codes the register searches by.
- **Key:** none. Turn the card's switch on and it is ready.
- **Licence:** the data is under the Licence Ouverte (Etalab). The card says so.
- **Pace:** the register allows 7 calls a second. Lead finder keeps under it.

## What it finds

**Find companies** with **Search in: Register of France** searches active units by:

- **What they do**: pick an activity from the NAF rév. 2 list.
- **Where**: a town's name, a postcode (five digits) or a département (`69`, `2A`). Paris, Lyon and
  Marseille are searched across all their arrondissements, since the register files each business
  under its arrondissement.

A unit's row links to its page in the state's directory of businesses. A SIREN is nine digits,
such as `734 219 865` (made up: it fails the SIREN check).

## Businesses that said no

A French business may ask the register not to have its details used for sales
(`opposition_diffusion_commerciale`), and some are only partly public (`statut_diffusion: P`).
Lead finder shows such a unit with the chip **Asked not to be contacted for sales**, and it cannot
be added. You can still fill in the details of one you already have on a record, and no person at
it is ever kept.

## Sole traders are people

A sole trader (an "entrepreneur individuel", legal category 1000) is a person, not a company. Their
row shows **Sole trader: a person**:

- with People off, it cannot be added;
- with People on, it is added only together with the sole trader's own e-mail address, and they
  get the tell mail at once, like anyone found. See
  [People and the law](/guides/add-ons/lead-finder-people/).

## What it fills in

**Fill in details** with the register **Register of France** looks the unit up by its SIREN, or by
its name. It can fill in the registered name, the SIREN, the head office's address (with `FR` as
the country) and the activity.

The register lists a business's directors. Lead finder never keeps a director as a person, and
never reads their birth date or nationality.

## The tell mail in French

While the Register of France is on, the People card asks for the French version of "Why you keep
them": a person found at a French company is told in French.
