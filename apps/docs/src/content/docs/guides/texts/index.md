---
title: Set up texts
description: Send text messages (SMS) to your customers through your own Twilio or Telnyx account. Connecting the account, the sender, registration, a server with no public address, the daily limit, sending hours and countries.
---

From Adminium 0.3.76.

Adminium can send short text messages to your customers: reminders, "your order is ready", answers
to their replies and, with their agreement, offers. Each business uses **its own provider account**,
Twilio or Telnyx. The provider bills you for every text. Adminium holds no account, buys no numbers,
registers no sender and takes no money. It is not a party to any of it.

Customer phone numbers and the words of each text go to your provider and to the carriers that
deliver them. Adminium keeps no copy of a text's words, only its delivery record.

The rest of this section:

- [Text templates and the length counter](/guides/texts/templates/)
- ["Send text" in automations](/guides/texts/automations/)
- [Consent, STOP and the do-not-text list](/guides/texts/stop-and-consent/)
- [Marketing texts](/guides/texts/marketing/)
- [Conversations and replies](/guides/texts/conversations/)

## What you need

- A paid account with **Twilio** or **Telnyx**. A Twilio trial cannot do this job: it sends only
  Twilio's own templates to numbers you have verified.
- A number or a sender name in that account. You buy or register it in the provider's console.
- A person with the **Set up text messages** permission. Only the Super Admin has it until it is
  given to someone.
- For STOP replies and delivery reports: a server customers' providers can reach, at a public
  `https` address. See [A server with no public address](#a-server-with-no-public-address).

One provider account serves the whole server.

## Connect the provider

Open **Studio → Texts** and stay on the **Setup** tab.

1. Choose **Twilio** or **Telnyx**.
2. Copy the values from the provider's console:
   - **Twilio:** the **Account SID** (it starts with `AC`) and the **Auth Token**. Both are on the
     console's home page, under Account info. The Auth Token sends the texts and checks that updates
     really came from Twilio.
   - **Telnyx:** an **API key**, the **Public key** (both under Auth in the Telnyx portal), and the
     **Messaging profile id** of the profile that holds the numbers you send from. The public key is
     used only to check that updates really came from Telnyx.
3. Paste each value on its own, with nothing before or after it, and press **Check connection**.

The provider is asked about the keys before they are saved. The card then says what it found: a
live account and its name, a test key that delivers nothing, a trial account, a key the provider
did not accept, or a value pasted into the wrong field. If the provider cannot be reached, your
saved key does not change.

Keys of a **different account** are not saved straight away. The card names the account that would
be billed from then on, and you confirm it. The sender is cleared, because it belonged to the old
account.

**Disconnect** stops texts at once and deletes the keys from this server. Texts already handed to
the provider are not called back.

### Twilio and Telnyx after a timeout

Sometimes a provider takes a text and the answer never arrives. The two providers differ here:

- **Twilio** has no safe way to send a text again. Adminium never resends it by itself. The text
  reads **Unknown, check before resending** on the **Activity** tab, and a person checks Twilio's
  message log first. If it was not sent, they press **It was not sent. Send again**.
- **Telnyx** takes the same key again for 24 hours, so Adminium retries it safely in that time.

## Who texts come from

Under **Who texts come from**, enter a sender from your provider's console:

- **Number.** It can receive replies, so a text ends "Reply STOP to opt out."
- **Sender name**, up to 11 letters, digits and spaces. A name cannot receive replies. Each text
  ends with your phone number or e-mail for stopping instead, and staff record the request on the
  [do-not-text list](/guides/texts/stop-and-consent/#the-do-not-text-list). Marketing texts never go
  from a name.
- **Messaging service or number pool.** Replies depend on the senders in it, so texts give your
  phone or e-mail for stopping.

The phone or e-mail is the app's own phone number when it has one, or else the reply-to address of
your e-mail sender.

**Country for local numbers** is the country a number written without `+` is read in. With none
set, only numbers written with `+` and the country code can be texted.

## Registration

Some countries ask a business to register before it can text there. **In the United States,
unregistered texts are blocked.** You need a 10DLC or toll-free registration, and approval can take
days to weeks. Start it early.

Registration is between your business and your provider. Adminium cannot see it, approve it or
speed it up. Twilio and Telnyx do not tell Adminium whether a sender is registered, so the card
says so and links to the provider's registration page. Until a registration is approved, texts to
that country are not delivered.

The **Where you can text** table lists what each country needs, for example:

- **Spain:** unregistered sender names are blocked. **Australia:** they arrive labelled
  "Unverified". **Czechia:** T-Mobile and O2 block unregistered names. **France:** register your
  sender name.
- **Canada:** no sender names. Use a long code, a verified toll-free number or a short code.
- **Saudi Arabia** and the **United Arab Emirates:** registered sender names only. A text to the UAE
  may hold no number or link.
- **Taiwan:** the brand name must open each text.
- **India:** the domestic route needs DLT registration.

## No texts to mainland China

**Adminium does not send texts to mainland China (+86)**, from either provider. Neither can promise
delivery, replies or a working opt-out there. A text to a `+86` number is refused and the row says
so. Taiwan and Hong Kong are not affected.

## Countries where people cannot reply

In the United Arab Emirates, Egypt, Saudi Arabia and Taiwan, a person cannot reply to a text. Service
texts still go there, ending with your phone or e-mail for stopping. **Marketing texts never go
there**, because nobody can reply STOP.

## A server with no public address

A server on your own network, a server without `https`, and the desktop app can still **send
service texts**. They cannot receive anything back: no STOP replies and no delivery reports. The
**Can replies reach this server?** card says so plainly. On such a server:

- every text ends with your phone or e-mail for stopping, never "Reply STOP";
- marketing texts are off;
- a STOP a person sends goes only to the provider. Twilio and Telnyx block that number for your
  account, but Adminium does not hear it. Add the number to the do-not-text list when the person
  asks you.

When the server has a public `https` address, each text tells the provider where to send its
delivery reports. For replies, set your number's (or messaging profile's) address for incoming
messages to this server's text address. The address holds a secret part, so it is shown only to
people who may set up texts, on the **Setup** tab.

Every 30 minutes, and after a restart, Adminium also asks the provider what it missed, so a STOP is
not lost while the server is down. Telnyx gives no list of incoming messages, so a STOP in a local
word sent while the server was down is missed there. Telnyx's own opt-outs are still caught.

## Daily limit and sending hours

Under **Daily limit and sending hours**:

- **Texts a day, at most:** 500 unless you change it, up to 100,000. A warning shows at 80%. The
  count starts again at midnight on the business's clock. When the limit is reached, texts wait
  until the next day, unless their moment passes first. The limit protects your provider bill if an
  automation goes wrong.
- **Service texts** go between 08:00 and 21:00 on the business's clock unless you change it. A
  text due outside the hours waits for the next opening. A reminder whose moment comes before that
  opening is skipped, never sent late.
- Texts a customer is waiting for right now, such as "Your room is ready", may go at any time. Each
  app says which of its texts these are.
- **Marketing texts** go only from 09:00 to 20:00, Monday to Saturday. This is fixed. In a country
  with several time zones, they go only when the window is open in all of them.

## Send a test text

**Send a test text** sends one fixed text to a phone you hold: "Test text from Adminium. Your text
message connection works.", in your own language. The button cannot send anything else. It uses
your provider account and may cost a small charge. It never goes to a number on the do-not-text
list, and at most five go in ten minutes.

A test text gets no delivery report on this page, so look at the phone. With a test key, nothing is
delivered.

## What each text carries

Adminium adds the last line of every text, in the template's language:

- from a number that can take replies: "Reply STOP to opt out.";
- otherwise: "To stop these texts, contact" and your phone or e-mail.

France does not allow opting out by phone, so only an e-mail address is given there. A text to the
UAE names the business alone. If a sender that cannot take replies has no phone or e-mail to give,
the text is not sent.

A text never carries a sign-in link, a code or a QR value, and never asks the person to reply YES.
See [Text templates](/guides/texts/templates/).

## Who may do what

| Permission | What it allows |
|---|---|
| **Set up text messages** | Everything on **Studio → Texts**: keys, sender, limits, hours, templates, test texts, each app's replies switch. Settle a text that reads **Unknown**. |
| **Find, download and erase a person's data** | Read **Activity** and the do-not-text list, and record a stop request. |
| **Read customers' texts**, **Answer customers' texts** | The conversations. See [Conversations and replies](/guides/texts/conversations/). |

Only the Super Admin can take a number off the do-not-text list. An API key can never set up texts,
send a test text, or read or answer a customer's text.

Whoever runs the server can switch texts off for everyone. The page then says so, and nothing is
sent.
