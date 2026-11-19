---
title: "Lead finder: Hunter"
description: Find the people who work at a company, with their work e-mail addresses, from Hunter, with your own paid Hunter key. Used only while Lead finder keeps people; each look-up counts against your Hunter account.
---

Hunter (hunter.io) finds the work e-mail addresses published for a company's domain, with the
person's name and role. Lead finder uses it for one thing: the **People at {domain}** part of a
company's **Fill in details** sheet, which lists the people Hunter finds there so you can keep the
ones you need.

- **Host:** `api.hunter.io`, and no other.
- **Key:** yours, and **paid**: each look-up counts against your Hunter account.
- **Only while People is on.** With People off, Hunter is never asked. See
  [People and the law](/guides/add-ons/lead-finder-people/) before you switch it on.
- **Daily limit:** 100 look-ups a day unless you set another. Each member of staff may use half of
  the day. The pace Hunter allows (15 calls a second) is kept to.

:::caution[You decide, and you answer for it]
Every person you keep, you keep as your business's own record of them: for the law, your business
is the controller of those details, not Adminium and not Hunter. Lead finder tells each person at
once, and erases them when it must, but whether you have a reason to keep them is yours to judge.
:::

## Getting the key

1. Sign in to your account on hunter.io.
2. Open its API page and copy your API key.

## Putting it in

1. Open **Lead finder** in the Library and press **Sources**.
2. On the **Hunter** card, paste the key and press **Check**. Check asks Hunter for your account's
   details, which spends no look-up. The card says "accepted" or "refused", then shows only the
   key's last four characters.
3. Set the **Daily limit** (**Edit**, then **Save**), and turn the switch on.

Adminium sends the key in a request header, never in an address.

## Finding people at a company

On a company's record, open **Fill in details**. With People on and the Hunter key saved, the sheet
has a section **People at {domain}**, for the domain of the website on the record. A company with
no website has nobody to look for.

1. Press **Find people**. That is one look-up on your Hunter account.
2. What Hunter answers is listed: each person's name, role and work address, and when Hunter found it.
   Only addresses Hunter marks as a person's, with a name, are listed: never a shared address such
   as `info@` or `sales@`.
3. Tick the people to keep, and press **Keep ticked people**.

Some are not kept, and the sheet says why:

- **On the do-not-email list**: they asked before not to be written to, or objected. Someone who
  objected is never found again.
- **Already a contact**: their address is on a contact already (anyone's, even one you cannot
  open). They get no mail.
- **A shared address, not a person.**
- **No name to keep them by.**

Each person kept becomes a contact in your app's people table, at that company, written as you.
Their address is not marked "may be e-mailed". The tell mail goes to them **at once**: until it has
gone, no other mail from Adminium reaches them.

Lead finder also keeps the pages Hunter saw each address on (at most twenty), so the person can be
told, and can ask, where their address was published.
