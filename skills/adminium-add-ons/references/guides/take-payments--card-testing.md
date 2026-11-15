<!-- produced from apps/docs/src/content/docs/guides/take-payments.md § Card testing; do not edit -->

# Take payments: Card testing

Card testers try stolen card numbers on small payments to find the ones that still work. Adminium
guards every pay link: the customer passes a short check before each payment, a link takes at most
20 payments an hour and a network address 60, and five declined cards lock a link.

When an app's own screens start payments (an order a customer pays for at checkout), Adminium adds:

- **Its own link.** A payment started from an app's screens gets a link of its own, apart from the
  link you sent. Declines there never lock your link.
- **Declines per address.** An address with five declined cards within the hour gets no new
  checkout from an app's screens.
- **A pause.** When cards are declined from ten different addresses within the hour, payments
  started from apps' screens pause for an hour. The apps then offer their other ways to pay, links
  you send keep working, and the people who set up payments are told. **Resume** in Studio →
  Payments ends the pause sooner.

Adminium keeps a scrambled form of the address, never the address itself, and forgets it after
three hours.

Turn on your service's own checks too. On Stripe, Radar is on by default. With Radar for Fraud
Teams, a velocity rule such as `Block if :declined_charges_per_ip_address_hourly: > 3` stops a run
of declines from one address. Check the attribute in the Stripe rule tester before you save it.
