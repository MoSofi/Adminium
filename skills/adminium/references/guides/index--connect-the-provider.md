<!-- produced from apps/docs/src/content/docs/guides/texts/index.md § Connect the provider; do not edit -->

# Set up texts: Connect the provider

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
