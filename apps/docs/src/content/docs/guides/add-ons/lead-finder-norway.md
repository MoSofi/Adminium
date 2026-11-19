---
title: "Lead finder: Register of Norway"
description: Find Norwegian businesses by SN2025 activity code and municipality, and fill in one unit's registered details by its organisation number or name, from the Brønnøysund Register Centre. No key.
---

The Register of Norway is the Central Coordinating Register for Legal Entities (Enhetsregisteret),
kept by the Brønnøysund Register Centre. Lead finder uses its open API to **find businesses** by
what they do and the municipality they are in, and to **fill in** one unit's registered details
by its organisation number or its name.

- **Host:** `data.brreg.no`, and no other. The register lists its own municipalities, so a typed
  town needs nothing else.
- **Key:** none. Turn the card's switch on and it is ready.
- **Licence:** the data is under the Norwegian Licence for Open Government Data (NLOD), from
  Brønnøysundregistrene. The card says so.

## What it finds

**Find companies** with **Search in: Register of Norway** searches units that are neither bankrupt
nor being wound up, by:

- **What they do**: pick an activity from the SN2025 list, Norway's standard industrial
  classification from 2025. A broad heading searches every code under it.
- **Where**: a municipality, by its name.

A unit's row links to its page in the register's own search. An organisation number is nine
digits, such as `914 732 586` (made up: it fails the register's check).

The register gives a business's switchboard number, never a mobile number: Lead finder takes only
the switchboard.

## Sole traders are people

A sole proprietorship (organisation form `ENK`) is a person, not a company. Its row shows **Sole
trader: a person**: with People off it cannot be added; with People on it is added only together
with the owner's own e-mail address, and they get the tell mail at once. See
[People and the law](/guides/add-ons/lead-finder-people/).

## What it fills in

**Fill in details** with the register **Register of Norway** looks the unit up by its organisation
number, or by its name. It can fill in the registered name, the number, the business address (with
`NO` as the country), the switchboard phone, the website the register holds, and the activity.

## The tell mail for a Norwegian company

Norwegian is not one of the languages Lead finder's mail is written in. A person found at a
Norwegian company is told in your install's language and in English.
