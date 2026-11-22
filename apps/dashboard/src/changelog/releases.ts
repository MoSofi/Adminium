// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The checked-in release feed behind `/changelog`.
 *
 * SOURCE CHOICE. The repo versions with changesets (`.changeset/config.json`,
 * `fixed: [["@adminium/*"]]`), which generates a per-package `CHANGELOG.md` at
 * `changeset version` time. Those files now exist, but they are per-package and
 * written for people reading a registry listing ("Updated dependencies"), not a
 * product changelog — so the feed stays hand-authored and checked in, Zod-
 * validated at import, and shaped so a future `CHANGELOG.md` parser can fill it
 * mechanically (`parseChangelogMarkdown() → Release[]`) without touching the
 * page. It is a data file, not an array inlined in a component — the page never
 * hardcodes copy.
 *
 * ONLY TAGGED RELEASES, AND NOT EVERY ONE. The feed must never run ahead of
 * the version the About screen reports (`apps/server/src/version.ts` →
 * apps/server/package.json). It once listed 0.2.0–0.5.0 before any of them
 * were cut, which made a fresh install look four releases stale to its own
 * operator. Add an entry only when its tag exists; small patch releases are
 * left out and their changes read in the per-package CHANGELOG.md.
 *
 * It is a `.ts` module rather than `.json` on purpose: this repo deliberately
 * avoids JSON imports (see `packages/i18n/scripts/gen-resources.mjs` — the TS
 * mirrors exist precisely so nothing needs JSON import attributes under
 * NodeNext + the browser bundler).
 *
 * TRANSLATION NOTE. Release notes are NOT localized, and that is deliberate:
 * they are a historical record of what shipped, written once at release time.
 * Localizing them would mean either shipping 8 stale translations or blocking
 * every release on a translation round-trip. The page CHROME (title, filters,
 * empty state) is fully localized; the entries stay in the language they were
 * written in — the same call GitHub, Stripe and Linear all make.
 */
import { z } from 'zod';

/**
 * The comp's tag taxonomy (`Changelog.dc.html`), preserved verbatim —
 * It is a keeper: "tag taxonomy New/Improved/Fixed/
 * Security w/ empty-release hiding".
 */
export const CHANGE_TAGS = ['New', 'Improved', 'Fixed', 'Security'] as const;
export type ChangeTag = (typeof CHANGE_TAGS)[number];

export const changeSchema = z.object({
  tag: z.enum(CHANGE_TAGS),
  text: z.string().min(1),
});

export const releaseSchema = z.object({
  /** Semver, displayed in the version gutter. */
  version: z.string().min(1),
  /** ISO-8601 date — rendered through the Intl layer, never pre-formatted. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO-8601 date (YYYY-MM-DD)'),
  title: z.string().min(1),
  summary: z.string().min(1),
  /**
   * What someone running Adminium has to do around this upgrade, shown above
   * the release's title. Its heading is data, like every other word in the feed.
   */
  notice: z.object({ title: z.string().min(1), items: z.array(z.string().min(1)).min(1) }).optional(),
  changes: z.array(changeSchema).min(1),
});

export type Change = z.infer<typeof changeSchema>;
export type Release = z.infer<typeof releaseSchema>;

/** Newest first — the page renders in array order. */
const RAW: unknown = [
  {
    version: '0.3.71',
    date: '2026-11-23',
    title: 'Online bookings, calendars and access rules',
    summary:
      'Adminium can now run a bookings business: staff calendars that sync, buffers and time off, invitations that update themselves, and customer pages that sit inside your own website. It also sets who can hand out keys, roles and links, so please read the notice above first.',
    notice: {
      title: 'Before you upgrade',
      items: [
        'Old notifications are deleted for good. The first cleanup after the upgrade, at 03:00 UTC, deletes notifications that were read more than retention.notificationsDays ago (90 days unless you changed it). Unread ones stay until they are read. To keep older ones, raise that setting first. It has no screen yet, so the statement to run is in the docs: Upgrading, “Keep read notifications longer”. If you have only just upgraded, you still have until the next 03:00 UTC.',
        'API keys made by suspended people stop working. The upgrade revokes, once, every API key made by someone who is suspended at that moment, and writes each one to the audit log with who made it. A revoked key cannot be restored, even by reactivating the person, so a shared integration running on one needs a new key. A key with no recorded maker keeps working: revoke any you do not recognise on the API keys page.',
        'A key or role holds at most what the person handing it out holds. A new API key can never hold more than whoever makes it, and only a signed-in Super Admin can make a Super Admin key. Someone who manages roles and is not a Super Admin can give out only what they hold, and cannot edit roles above them. Keys and roles that exist today are not changed, so if a custom role has held “Manage API keys” or “Manage roles”, review your keys and who holds which role.',
        'If you run several replicas, finish replacing all of them before you suspend anyone.',
      ],
    },
    changes: [
      { tag: 'New', text: 'A booking rule can keep a buffer after each visit, block the times a person is away, share “anyone” evenly, cap a person’s hours, hold only guests to the booking window, and offer a waiting-list time that holds nothing until it is taken.' },
      { tag: 'New', text: 'Each person can connect their own calendar from a link that needs no account. Bookings go out to it and its busy times block new ones. Staff on screens-only roles can see their busy times and clashes and keep a clash.' },
      { tag: 'New', text: 'A booking’s mail can carry a real calendar invitation that updates and cancels in place, and each person can have a private calendar feed they can renew.' },
      { tag: 'New', text: 'When a calendar connection ends, events that could not be removed are tried again for up to six hours while its access still works. If a customer’s name may still be in that calendar, whoever manages the connections is told whose calendar to clear.' },
      { tag: 'New', text: 'An app’s customer pages can run inside a frame on the websites its owner lists, with a button or a sheet, a snippet maker in the studio, and a payment that returns to the page it started from.' },
      { tag: 'New', text: 'A review mail can carry a link that reviews one visit and nothing else, a service mail sent for a purpose carries a working stop link, and a studio’s own cancel can refund by itself.' },
      { tag: 'New', text: '“Delete my details” can also empty the person’s own copies on rows linked to them, such as the name on a past booking. An app turns it on with forget.copies, and tables the law keeps stay whole. The public client’s forgetMe() now also says what the delete could not reach: balances still live and gifts not linked to the person.' },
      { tag: 'New', text: 'An add-on can show a signed-in customer the rows it holds for them, let them spend one without its code reaching the browser, run an outside script in a sandboxed page, and show a date column as there or not.' },
      { tag: 'Improved', text: 'The built-in demo calendar exists only when NODE_ENV is exactly test or development, so a server with NODE_ENV unset does not have it.' },
      { tag: 'Improved', text: 'The Roles page says plainly that “Install and manage apps and add-ons” equals full access, because apps and add-ons run code on the server.' },
      { tag: 'Fixed', text: 'Row limits an owner sets stay in place through app updates, restarts, table renames, config imports and later edits. Taking an owner’s limit off returns the role to the limit its app declares, straight away.' },
      { tag: 'Fixed', text: 'A dated mail that comes due while its setting is off is dropped and does not go out when the setting returns. A mail not yet due is kept, so turning a setting off and on again loses no reminder. A mail a person held, approved or queued again still goes out.' },
      { tag: 'Fixed', text: 'A dated mail goes to the person’s address as it stands when the mail is sent.' },
      { tag: 'Fixed', text: 'The hourly limit on public forms counts each visitor on every form.' },
      { tag: 'Fixed', text: 'The Designer reads each search, sort and filter on a customer screen against what its list declares, and names the exact field to add when one is missing.' },
      { tag: 'Fixed', text: 'The public client’s list call sends its via filter, so a shop can filter products through their variants. A list that declares no via answers 400 PUBLIC_QUERY_REFUSED to such a call.' },
      { tag: 'Security', text: 'Secret codes in web addresses stay out of the request log and the audit log, including mail service notice addresses, the link that lets a found person object and be erased, mail and pay links, and undo codes. Logs written before this release are not rewritten: if other people can read your logs and you use the “other” mail service without a password, replace its notice address.' },
      { tag: 'Security', text: 'A secret code in a web address stays out of the request log and the audit log however the address is written.' },
      { tag: 'Security', text: 'An API key holds at most what its maker holds. A key made by a key is held to both, cannot outlast the key that made it, and only a key with a person behind it can make keys.' },
      { tag: 'Security', text: 'Someone who manages roles and is not a signed-in Super Admin can set only permissions they fully hold, and cannot rename, change, delete, give or take a role that holds more than they do. The Roles and Team pages show what you cannot give and say why.' },
      { tag: 'Security', text: 'Changing someone’s account takes holding what they hold, and team, hand-over and sign-in changes take already reaching the rows involved. Anyone who manages users can suspend someone, and the workspace always keeps a Super Admin who can act. Giving an invited person another role ends their current invitation, so send them a new link afterwards.' },
      { tag: 'Security', text: 'Suspending or deleting someone closes their live connections at once and revokes every API key they made. Reactivating them does not bring the keys back.' },
      { tag: 'Security', text: 'Suspending or deleting someone also ends their unused password-reset links and the invitations they sent that nobody has accepted yet. A person still waiting on one of those invitations needs a new one.' },
      { tag: 'Security', text: 'An invitation link works only while the account is still invited, a new link retires the earlier ones, and using any link retires the rest. Password and invitation links stay out of the request log.' },
      { tag: 'Security', text: 'Another person’s export opens only for someone who holds exports.manage and can read its whole table.' },
      { tag: 'Security', text: 'Another person’s import opens only for someone who holds imports.manage and can read its whole table.' },
      { tag: 'Security', text: '“Delete my details” also empties what the audit log and the removed-row history kept of the person’s rows, as a staff erasure does.' },
      { tag: 'Security', text: 'With “Link answers to names” off, a survey’s invitations hold no time that matches an answer, and the daily sweep keeps them that way.' },
      { tag: 'Security', text: 'Changing your own sign-in address needs a link sent to the new address, opened while signed in. The old address keeps working until then.' },
    ],
  },
  {
    version: '0.3.70',
    date: '2026-11-21',
    title: 'Ready for the online shop',
    summary:
      'The add-ons that come with Adminium are now 1.0.33, with e-gift cards sold online, packing slips and customer reviews. Guest orders typed in somebody else’s address no longer act in their name.',
    changes: [
      { tag: 'New', text: 'The add-ons that come with Adminium are now 1.0.33: Inventory tells a shopper how many are left when an order is refused, Offers & gift cards sells e-gift cards online and calls one back with its sale, Invoices & Receipts prints packing slips and a receipt’s delivery and payments, and Forms & surveys keeps customers’ reviews.' },
      { tag: 'New', text: 'An app’s review word can say who proved who they are (`proved`). An order’s own link then reviews only an order placed signed in.' },
      { tag: 'Fixed', text: 'An e-gift card sold online is mailed to its recipient when its order is paid. A payment that lands now tells the add-ons what its order’s move set off, as every other save does.' },
      { tag: 'Fixed', text: 'A return asked through an order’s own link can add its pieces, even when Adminium copies a link onto each piece that the link’s key does not read.' },
      { tag: 'Fixed', text: 'A shop’s own e-mail to its staff, such as a new order, is written in the workspace’s language, not the customer’s.' },
      { tag: 'Fixed', text: 'A catalogue can filter its products through their variants while the variants also answer stock words.' },
      { tag: 'Security', text: 'A guest order typed in somebody else’s address no longer gives its link holder that person’s name, nor a review in it, and no longer spends their first-order code.' },
    ],
  },
  {
    version: '0.3.69',
    date: '2026-11-20',
    title: 'Trials built from your own database',
    summary:
      'A hosted trial can now be made from the visitor’s own Postgres or MySQL database: checked first, reached only at the one address it allows, and set up with the visitor’s notes. The Designer can make a trial’s first build on the host’s AI.',
    changes: [
      { tag: 'New', text: 'A host can start a trial on the visitor’s own database. Its pages are made from the tables they pick, for the kind of dashboard they chose, and the schema assistant then reads their notes once and names, groups and lays out what it is sure of. You can undo that later.' },
      { tag: 'New', text: '`adminium check-source` reads a database address and says whether this server would connect to it, and if not, why: the login was refused, it could not be reached, the certificate did not match, it has no tables, and so on. It never shows the database’s own message or a row.' },
      { tag: 'New', text: '`adminium archive create --without-your-database` leaves the visitor’s address out of an archive. After a restore, that database waits as a draft until its address is given again.' },
      { tag: 'New', text: 'The Designer can run a trial’s first build from the visitor’s idea, once, on the host’s AI. It waits by itself when the AI server is busy.' },
      { tag: 'Security', text: 'A trial reaches the visitor’s database only at the one host it was given, never at the host’s own servers, a private or reserved address, or a port it does not allow. Five refused logins lock that one login for an hour, never the server’s own database.' },
    ],
  },
  {
    version: '0.3.68',
    date: '2026-11-20',
    title: 'Reviews, shop filters, and rules that ask about stock',
    summary:
      'Customers can review what they bought, a shop’s catalogue can be filtered, searched and sorted by its shoppers, a rule can wait for stock to come back, and money stays hidden from a role that may not read it.',
    changes: [
      { tag: 'New', text: 'Customers can review what they bought once it has shipped (or a visit once it is done). Each review waits until your staff publish it, hide it for one of four reasons, or reply. The totals count published reviews only, and a forgotten customer’s reviews keep their words without their name.' },
      { tag: 'New', text: 'A public list can let shoppers filter it, search it, sort it and count it, and filter products by their variants: “Slate and M” finds only a product with one variant that is both.' },
      { tag: 'New', text: 'A rule can ask an add-on whether the stock a record names is back. It never goes ahead while the add-on is off or cannot answer.' },
      { tag: 'Security', text: 'Someone whose role reads a record but not its money no longer sees its Payment panel, its paid or unpaid badge, or its total on a pay link, and cannot record a payment or take a card payment on it.' },
      { tag: 'Fixed', text: 'Searching for “100%” or a word with an underscore finds that text as typed. On SQLite, such a search used to find nothing.' },
    ],
  },
  {
    version: '0.3.67',
    date: '2026-11-20',
    title: 'A developer’s add-on list stays on developer machines',
    summary:
      'The list of add-ons a developer trusts by name now works only on a server that says it is for tests or development, and a campaign’s send log names a person who has not been told yet.',
    changes: [
      { tag: 'Fixed', text: 'A campaign’s send log now names a person a lead source found, and who has not been told yet where their details came from, as “found person, not told yet”, not as someone who hasn’t agreed.' },
      { tag: 'Security', text: 'ADMINIUM_ADD_ON_DEV_TRUST now works only with NODE_ENV set to test or development. Set anywhere else, the server refuses to start and says how to fix it; in production it is ignored, and the log says so at every start.' },
    ],
  },
  {
    version: '0.3.66',
    date: '2026-11-20',
    title: 'Finding companies, and telling the people you keep',
    summary:
      'Add-ons can now find companies for you: in the UK, French and Norwegian registers by what they do and where, and fill in a company you already have from its register and its own website. If you choose to keep the people found at a company, Adminium tells each one at once where their details came from, with a way to object.',
    changes: [
      { tag: 'New', text: 'An add-on that finds companies searches the registers by trade and place, adds the ones you tick to your companies table as yours, and shows a company that is already there, even one a colleague keeps, without its details.' },
      { tag: 'New', text: 'On a company’s own page, “Fill in details” reads the company’s register and one page of its website, shows what it found beside what you have, and fills only what you tick. A filled field says where it came from and when, until someone changes it.' },
      { tag: 'New', text: 'People found at a company are kept only if you turn that on. Each one is mailed at once, in their country’s language, with what was kept, why, for how long, their rights and an Object button that deletes them. Nobody else can write to them until that mail has gone.' },
      { tag: 'New', text: 'Automation rules gain a step “Fill in the company”, which fills only empty details from the free registers. It never reads a website.' },
      { tag: 'New', text: 'An add-on can now keep one key per service it uses, each saved, checked and switched on its own, with a daily limit for paid services.' },
      { tag: 'Improved', text: 'The add-ons that come with Adminium are now 1.0.31, Landing pages among them.' },
      { tag: 'Improved', text: 'A website reader built into Adminium reads one page of a company’s site, asks robots.txt first, and keeps only the company’s own facts: never a person’s name, a named address or a mobile number.' },
      { tag: 'Fixed', text: 'A table’s CSV download no longer hands a spreadsheet a formula, and a link cell never opens a javascript: address.' },
      { tag: 'Security', text: 'Every add-on whose code Adminium runs now loads only from a package Adminium can vouch for. Add-ons that were already running keep running, and one that does not load now says so on the Add-ons page.' },
    ],
  },
  {
    version: '0.3.65',
    date: '2026-11-19',
    title: 'Landing pages, and counting what visitors see',
    summary:
      'Add-ons can now carry landing pages: pages for an offer or an event, built from blocks, drawn by Adminium for visitors at their own address with a title and a sharing preview. Adminium now counts how often your public pages and forms are seen, with no cookie and nothing about the visitor kept.',
    changes: [
      { tag: 'New', text: 'A landing page lives at /x/pages/<address> on your public address, or as the home of a pages host. Adminium writes its title and sharing preview, serves its pictures and lets search engines find it once it is live.' },
      { tag: 'New', text: 'Views of your landing pages and forms are counted at “Counts only”, the new default: no cookie, no banner, known bots left out. Studio → Privacy & public pages → Visitor counting turns it off, or to “Per visitor”, which asks first with a banner and keeps a visitor’s pages with what they send you.' },
      { tag: 'New', text: 'Milo can draft a landing page from a description. Every section it writes is marked, and the page cannot be published until a person has looked at each one.' },
      { tag: 'New', text: 'A form can end by sending the visitor to one of your landing pages.' },
      { tag: 'Improved', text: 'An app’s page no longer jumps when its “Sample data is loaded” banner appears.' },
      { tag: 'Improved', text: 'The add-ons that come with Adminium are now 1.0.30, Live chat among them.' },
      { tag: 'Fixed', text: 'Milo can draft live chat replies again: the drafts asked the AI service in a way every provider refused.' },
      { tag: 'Fixed', text: 'An add-on whose files were put back from their kept copy after a redeploy is trusted as before, so its forms, chats and pages keep working.' },
      { tag: 'Security', text: 'Pages a visitor sees under /x/ now carry stricter browser protections, and never act with a signed-in person’s rights.' },
      { tag: 'Security', text: 'A card terminal is loaded only from an add-on Adminium can vouch for.' },
    ],
  },
  {
    version: '0.3.64',
    date: '2026-11-18',
    title: 'A live chat for your website',
    summary:
      'Add-ons can now carry a live chat that a website shows with one line. Visitors write to your team, or get the automatic answers you write; outside your hours they leave a question that becomes a row in an app. Your team answers from the dashboard.',
    changes: [
      { tag: 'New', text: 'A website shows an add-on’s live chat with one script line. Visitors see your hours, your welcome line and who is answering, in their own language.' },
      { tag: 'New', text: 'Staff take a chat, reply, close and reopen it from the dashboard. A reply can follow by e-mail once the visitor has left, and “Make an enquiry” turns a chat into a row of an app.' },
      { tag: 'New', text: 'Automatic answers use the AI service you choose, within a daily token limit you set. A visitor’s e-mail addresses and phone numbers are masked before the text leaves, and new chats pause for an hour after too many start at once.' },
      { tag: 'New', text: 'An add-on’s pages can follow a table as it changes, and open the assistant with words ready in its box.' },
      { tag: 'Improved', text: '“Can visitors reach your public pages?” now says when it cannot tell whether visitors come through a proxy.' },
      { tag: 'Fixed', text: 'The host of the address in email links can no longer be mapped to an app or the add-on pages, and a host already mapped is never taken as that address.' },
      { tag: 'Fixed', text: 'A table keyed by text that Adminium makes now gets a key on every create, sample rows included.' },
    ],
  },
  {
    version: '0.3.63',
    date: '2026-11-17',
    title: 'Trying an app as a customer sends its e-mails to you',
    summary:
      'When someone who manages payments tries an app as a customer, the app’s e-mails about that test order now reach them, marked [TEST], with the order’s own link and a test pay button. A real customer’s e-mail is never held back while someone is trying the app.',
    changes: [
      { tag: 'Fixed', text: 'A test order’s e-mails reach the person trying the app as a customer, with the order’s own link, where they were refused before.' },
      { tag: 'Fixed', text: 'A test order’s e-mail gets a test pay button, which opens the same pay page as the checkout.' },
      { tag: 'Fixed', text: 'While someone tries an app as a customer, e-mails about real orders still go to their real customers, as ordinary e-mails.' },
      { tag: 'Fixed', text: 'A till cashier can close a pay link they made.' },
    ],
  },
  {
    version: '0.3.62',
    date: '2026-11-17',
    title: 'Payments in apps: closer to how each app works',
    summary:
      'Apps that take payments can now hold back what needs a payment while payments are off, keep a booking from changing while money is on its way, send different mail when payments are on, and say when a refund was sent. A till’s cashier can use the card reader and pay links, and payments write their keys on every database.',
    changes: [
      { tag: 'New', text: 'A public entry can be open only while the app takes payments, or only while it does not, so a booking that must be paid cannot be made around the payment.' },
      { tag: 'New', text: 'A status change can wait while a payment is on its way, and an app’s mail can be sent only while payments are on, or only while they are off.' },
      { tag: 'New', text: 'A payment made on the pay page can set a column of the record it pays, and an app’s refund row announces when it is sent, so its mail can follow.' },
      { tag: 'New', text: 'The Payment panel says who refunded a payment and why. A card reader charge says the card brand.' },
      { tag: 'Improved', text: 'The add-ons that come with Adminium are now 1.0.29: a printed invoice says until when its pay link works.' },
      { tag: 'Fixed', text: 'On SQLite and MySQL, a payment Adminium writes into an app table keyed by a uuid now gets its key.' },
      { tag: 'Fixed', text: 'A till cashier with screens-only access can take a payment on a card reader or by a pay link.' },
      { tag: 'Fixed', text: 'Payment services are named by their own marks everywhere, PayPal included.' },
    ],
  },
  {
    version: '0.3.61',
    date: '2026-11-16',
    title: 'Card readers come with Adminium, and apps say how a payment stands',
    summary:
      'The bundled add-ons are now 1.0.28, with Card readers for a Square Terminal at the counter. An app’s own customer screens can now tell a customer coming back from the pay page whether the payment went through, and a few gaps in apps that take payments are closed.',
    changes: [
      { tag: 'New', text: 'Card readers comes with Adminium: it connects to Square, so a till puts the amount on a Square Terminal. Card payments also runs Stripe smart readers with the same key, which needs three more permissions once a reader is paired.' },
      { tag: 'New', text: 'An app’s customer screen can ask how a record’s online payment stands (GET /api/v1/public/payments/state, client.payments.state()): open, the bank confirming, paid, did not finish, or expired. Only for a record the visitor can already read, and one word only.' },
      { tag: 'New', text: 'A printed document can say until when its pay link works: a date slot whose default is pay-link takes the day that link stops opening.' },
      { tag: 'Fixed', text: 'An app whose payable sits in a part it installs without now installs: the payable goes with the part.' },
      { tag: 'Fixed', text: 'The record page’s Payment panel shows the day, the service, the last four and the currency of an app’s online payments.' },
      { tag: 'Fixed', text: 'An app whose only public door is a shared link’s key keeps its public access through an update that widens it, without asking again.' },
    ],
  },
  {
    version: '0.3.60',
    date: '2026-11-16',
    title: 'Apps take payments, and card readers at the counter',
    summary:
      'Apps from the catalog can now ask their customers to pay online, keep and send refunds the way they already do, and put an amount on a card reader at the till. Every app’s payments arrive switched off, for someone who manages payments to switch on.',
    changes: [
      { tag: 'New', text: 'Payments → Apps: one “Can take payments” switch per installed app that asks customers to pay. An app’s payable tables read “From {app}” in What can be paid.' },
      { tag: 'New', text: 'An app’s own screens ask whether payments are on (GET /api/v1/public/payments/available) and start one for a record the visitor can read (POST /api/v1/public/payments/start). The public client has payments.available() and payments.start().' },
      { tag: 'New', text: 'Rehearse an app’s checkout before going live: “Try {app} as a customer” in Payments → Apps runs test payments on sample rows, with the app’s e-mails sent to you alone, marked [TEST].' },
      { tag: 'New', text: 'Refunds the app’s way: an app that keeps a refund as a row of its own gets the money sent back for each such row, once; a payable may refund by itself after a cancellation the customer or the clock makes.' },
      { tag: 'New', text: 'Card readers: a new add-on contract (card-terminal@1), Payments → Card readers to pair them, and charge routes a till uses to put an amount on a reader, follow it and cancel it. The tip lands apart. A reader-only service such as Card readers for Square is connected in Payments beside the others.' },
      { tag: 'Security', text: 'Payments an app’s screens start are guarded against card testing: per-address and per-install limits, a lock after repeated declines, and a pause with “Resume now” when declines come from many addresses.' },
      { tag: 'Security', text: 'A payment taken online is written by the payment alone: no person, key, rule or import may create, change or delete a row carrying a payment’s reference.' },
    ],
  },
  {
    version: '0.3.59',
    date: '2026-11-15',
    title: 'Mail and archives for hosted installations',
    summary:
      'For people who run Adminium for others: an installation can send its mail through your mail server until it has one of its own, an archive of a running instance holds one moment, and one call downloads again the apps and add-ons a restore left missing.',
    changes: [
      { tag: 'New', text: 'ADMINIUM_OPERATOR_SMTP_URL and ADMINIUM_OPERATOR_MAIL_FROM send an installation’s mail through the operator’s mail server while it has none of its own, capped by ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY (500 a day by default). Saving its own mail server moves all mail there with no cap.' },
      { tag: 'New', text: 'POST /api/v1/operator/reinstall downloads again every catalog app and add-on that is installed but whose files are missing, as after a restore or a deploy that emptied the data directory.' },
      { tag: 'Improved', text: 'adminium archive create and Studio’s “Download everything” read the meta store inside one read-only snapshot, so a row written during the archive is in all of its tables or in none.' },
    ],
  },
  {
    version: '0.3.58',
    date: '2026-11-14',
    title: 'Switches for operators, and safer SQL text',
    summary:
      'For people who run Adminium for others: start a copied instance without running anything that is due, keep an instance awake while someone reads, and let an old tab wake a sleeping one. Plus SQL text read the way each database reads it.',
    changes: [
      { tag: 'New', text: 'ADMINIUM_SCHEDULER=off starts the server without its scheduler and job queue, so you can check that a copied instance starts without anything due running on both the copy and the original.' },
      { tag: 'New', text: 'ADMINIUM_PRESENCE=on has the dashboard tell the server once a minute that someone is using it, for a proxy that puts idle instances to sleep.' },
      { tag: 'Improved', text: 'Behind a proxy that puts instances to sleep, an old tab reloads and wakes the instance instead of a page that stops answering. A save keeps what you typed.' },
      { tag: 'Fixed', text: 'A trial’s size cap on MySQL keeps counting a dropped column’s values after a restart, and counts them on MariaDB too.' },
      { tag: 'Fixed', text: 'Every built file in the npm packages and the Docker image carries its licence line again.' },
      { tag: 'Security', text: 'SQL text in a schema change, such as an expression default or a check, is read the way its own database reads it, so a second statement hidden in it is refused on every engine.' },
      { tag: 'Security', text: 'The meta store’s database is reached at the address its host name was checked at, checked again for each new connection.' },
    ],
  },
  {
    version: '0.3.57',
    date: '2026-11-13',
    title: 'Local databases, Export everything and trial mode',
    summary:
      'Connect a production server to a database on the same machine, take a whole installation with you in one file, and give a fresh server a one-time setup token. For people who run Adminium for others: trial mode, a hosted profile, an operator endpoint with signed events, Connect Supabase and a mail relay.',
    changes: [
      { tag: 'New', text: 'Allow databases on this server: a Super Admin can let a production server connect to a database on its own machine, or the operator names exactly which host and port with ADMINIUM_DATABASE_HOSTS.' },
      { tag: 'New', text: 'Export everything: one file with everything made in the installation (pages, people without their passwords, uploads, local SQLite databases, the project folder). The desktop app opens it as a new project.' },
      { tag: 'New', text: 'adminium archive create and restore move a whole instance to another server, from any database engine to any other.' },
      { tag: 'New', text: 'A fresh server asks for a one-time setup token, printed in its log, before anyone can create the first account. The desktop app and adminium dev do not ask.' },
      { tag: 'New', text: 'Secrets can be given as files (ADMINIUM_SECRET_FILE and the same _FILE ending for every secret), the way Docker and Kubernetes hand them over.' },
      { tag: 'New', text: 'ADMINIUM_NETWORK_POLICY=strict keeps databases, webhooks, storage, mail and AI addresses off the server’s own network.' },
      { tag: 'New', text: 'Trial mode and the hosted profile, for operators who run Adminium for other people: banners with the days left, an end date after which the installation is read-only, size caps, a mail relay, and every switch that keeps a stranger off the operator’s machine.' },
      { tag: 'New', text: 'An operator endpoint on its own listener and token, signed events about public pages, sign-ins and caps, Connect Supabase with a one-time code, and an AI budget the installation cannot reset.' },
      { tag: 'New', text: '“Put this online…” in the user menu, on About and in the desktop app opens the deploy guide.' },
      { tag: 'Improved', text: 'A server starts lighter: about 40 MB less memory once it is idle, and email templates are no longer seeded on every start.' },
      { tag: 'Improved', text: 'A source database’s host name is checked again for each new connection, so a managed database that fails over is followed within seconds.' },
      { tag: 'Security', text: 'Free SQL text that reaches a schema change, such as an expression default or a check, is refused when it could start a second statement. Earlier versions let a person allowed to change the schema run extra SQL this way.' },
      { tag: 'Security', text: 'An app’s screens are built with Adminium’s own TypeScript settings and never read the app’s tsconfig.json. Import an app’s own files by relative path; a paths alias such as @/components no longer resolves.' },
      { tag: 'Security', text: 'A SQLite source or a storage folder can no longer open Adminium’s own files, and the server takes its secrets out of its environment before any project code loads.' },
    ],
  },
  {
    version: '0.3.49',
    date: '2026-11-07',
    title: 'Your own apps, and workspaces',
    summary:
      'Save what you built on a database as an app of your own and install it on another server. Group a server’s databases into workspaces, one per team or business, each with its own menu and its own mail sender.',
    changes: [
      { tag: 'New', text: 'Save as app: turn a database’s tables, pages, roles, rules, mails, documents and reports into an app file, from Hosted apps or a connection’s card. Check lists what needs a choice and what the new owner fills in after installing. People, secrets and history never go in.' },
      { tag: 'New', text: 'Choose which rows travel with a saved app: up to 200 starting rows or 5,000 sample rows per table, picked by the page’s order or a saved view. Personal columns stay empty unless you include them.' },
      { tag: 'New', text: 'Saved from here lists every app version saved on this server, with its fingerprint, Download again and Save a newer version.' },
      { tag: 'New', text: 'Installing your own app shows where it was made, checks it against the fingerprint shown when it was saved, can use the tables already there with no change to them, and asks about each page whose address is taken.' },
      { tag: 'New', text: 'After you install: the app’s page lists the addresses, keys and senders to fill in after installing, and ticks each one off when it is done.' },
      { tag: 'New', text: 'Install the same app once on each database. Each copy has its own page, settings, roles, templates and keys, and Update every copy keeps them on one version.' },
      { tag: 'New', text: 'Workspaces group a server’s databases. Show them all in one menu or one at a time with a switcher; each browser tab keeps its own current workspace, and Library pages follow it.' },
      { tag: 'New', text: 'Each workspace can have its own mail sender, so mail about a record goes from its own business, with its own postal address on marketing mail. A template can name who it always goes as.' },
      { tag: 'New', text: 'Shown in: list an email template, campaign or report layout in chosen workspaces only. It narrows lists and pickers, never what is sent.' },
      { tag: 'New', text: 'Save workspace puts one app per database into a single file. Installing it chooses a database for each app, can create the workspace, and finishes with Install the rest after a stop.' },
      { tag: 'New', text: 'A saved app can carry the server’s look and words. It is applied only when someone who manages settings ticks it, and Undo on the app’s page puts back what was there.' },
      { tag: 'New', text: 'Download an app you made in a project folder, with its screens’ source; Make it editable here copies that source into another project.' },
      { tag: 'Improved', text: 'A saved app keeps its columns’ own names, such as orderDate or Order Total.' },
      { tag: 'Improved', text: 'An update that stops part way says where, and Finish the update completes it, even after a reload.' },
      { tag: 'Improved', text: 'The server as a whole is now called the server everywhere, and the sidebar group that held your pages is called Pages. Workspace means a group of databases.' },
      { tag: 'Security', text: 'Rules in an installed app file that send data out arrive switched off and empty, whatever the file says. Only someone who manages automations turns them on.' },
      { tag: 'Security', text: 'Before a file is saved, Adminium looks for every secret this server holds, whole, in pieces and encoded, and never writes one.' },
      { tag: 'Security', text: 'Workspaces organise the menu and are not a security wall: roles still decide who sees what. The do-not-email list stays one for the whole server.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-21',
    title: 'First public release',
    summary:
      'Point Adminium at a database and get a real admin panel — read-and-write, self-hosted, and open source under AGPL-3.0.',
    changes: [
      { tag: 'New', text: 'Connect a database, introspect the schema and generate a full CRUD admin app.' },
      { tag: 'New', text: 'PostgreSQL, MySQL/MariaDB and SQLite — or upload a Prisma schema, a Django models.py, a Rails schema.rb or a .sql dump and connect nothing at all.' },
      { tag: 'New', text: 'Studio: rename, regroup and re-shape the generated app, with every change stored as configuration rather than emitted code.' },
      { tag: 'New', text: 'The widget vocabulary — charts, Kanban boards with swimlanes, a calendar scheduler, org charts and Gantt timelines — with a drag-and-drop dashboard builder on top.' },
      { tag: 'New', text: 'Optional AI assist proposes labels, groupings and starter dashboards from your schema, always reviewed before it applies. Bring your own key, or copy the prompt and paste the response so nothing leaves your machine.' },
      { tag: 'New', text: 'Roles and permissions, audit log, API keys, jobs and notifications.' },
      { tag: 'New', text: '8 locales with full right-to-left support.' },
      { tag: 'New', text: 'Self-host your way: the adminium CLI (init wizard plus start, introspect, migrate, export-zip and import-zip), a multi-arch non-root Docker image with docker-compose.yml, or the desktop app.' },
      { tag: 'New', text: 'In-app Knowledge Base, Changelog and About screen with version, licence and the AGPL source offer.' },
      { tag: 'Security', text: 'Introspection and the AI prompt read schema metadata only — never your rows.' },
      { tag: 'Security', text: 'Stored database credentials and provider keys are encrypted at rest with a key derived from ADMINIUM_SECRET.' },
      { tag: 'Security', text: 'API keys are stored as a SHA-256 hash — the plaintext is shown once at creation and is never retrievable.' },
      { tag: 'Security', text: 'Telemetry and update checks are both opt-in and off by default; an opted-out instance makes no outbound call.' },
    ],
  },
];

/**
 * Parsed at module load: a malformed feed is a build-time mistake, and failing
 * here (loudly, once) beats a page that renders half a release.
 */
export const RELEASES: readonly Release[] = z.array(releaseSchema).min(1).parse(RAW);

/** The newest release — the sidebar version pill's source of truth. */
export const LATEST_RELEASE: Release = RELEASES[0] as Release;

// --- pure filtering (unit-tested without a DOM) ------------------------------

export interface FilteredRelease extends Release {
  changes: Change[];
}

/**
 * Filters a release feed to one tag, dropping releases left with nothing to say.
 *
 * The empty-release hiding is a keeper, and it is what makes the filter honest:
 * showing "v0.3.0" with an empty card under a Security filter implies a
 * security change nobody made.
 */
export function filterReleases(
  releases: readonly Release[],
  tag: ChangeTag | null,
): FilteredRelease[] {
  if (tag === null) return releases.map((release) => ({ ...release, changes: [...release.changes] }));
  return releases
    .map((release) => ({ ...release, changes: release.changes.filter((change) => change.tag === tag) }))
    .filter((release) => release.changes.length > 0);
}

/** Tags actually present in the feed — a filter chip for a tag nobody used is a dead end. */
export function availableTags(releases: readonly Release[]): ChangeTag[] {
  const present = new Set<ChangeTag>();
  for (const release of releases) {
    for (const change of release.changes) present.add(change.tag);
  }
  return CHANGE_TAGS.filter((tag) => present.has(tag));
}
