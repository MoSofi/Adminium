<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Upgrading; do not edit -->

# An app's emails: Upgrading

What a running install sees when it moves to a release with the features on this page:

- **No way back without the backup.** The upgrade runs two meta migrations:
  `0045_app_table_shapes`, which records the shape each app table is declared with (and fills it
  in for apps installed before), and `0046_public_sessions_ended`, which keeps a guest's ended
  session with the reason it ended. Once they have run, the earlier release refuses to start on
  that meta store (see [`unknown to this version`](https://docs.adminium.dev/self-hosting/upgrades/#unknown-to-this-version)).
  Going back means restoring the backup taken before the upgrade, so take one.
- **QR mail during a rolling deploy.** A message with a QR code is queued in a newer form than the
  earlier release reads. An instance of the earlier release that is still running and picks it up
  refuses it, and once its retries are spent the message is dead-lettered. Every other message is
  queued in the form the earlier release reads, and either release delivers it. Replace every
  instance before an app that draws QR codes starts sending.
- **Reply-To on an older instance.** A message handed to the mail queue with a Reply-To, and
  delivered by an instance of the earlier release, goes without the header. It is never refused
  for it.
- **`{{was.*}}` on an older instance.** The earlier release does not know what a message keeps of
  its row before a change. A template reading `{{was.*}}`, sent by an instance of that release,
  fails with "Not sent: nothing fills {{was.…}}". Once every instance is upgraded, set the message
  back to `queued` to send it.
