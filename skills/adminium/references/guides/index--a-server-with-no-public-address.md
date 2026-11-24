<!-- produced from apps/docs/src/content/docs/guides/texts/index.md § A server with no public address; do not edit -->

# Set up texts: A server with no public address

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
