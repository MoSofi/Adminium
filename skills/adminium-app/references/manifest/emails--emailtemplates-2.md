<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — emailTemplates; do not edit -->

# Manifest spec: Emails — emailTemplates

A QR code is the whole value of an image: an `email.image` block's `qr`, written
`{{<link>.<column>.qr}}` (80–200 pixels across, `size`), or a row's `image`. It is drawn when the
message is delivered, only of a code column, and only for a code of at most 64 bytes. A code the
[withhold](https://docs.adminium.dev/reference/manifest/#withheld-columns) or share-code rules keep from the message's recipient is printed
empty, in every form, its QR code included.
