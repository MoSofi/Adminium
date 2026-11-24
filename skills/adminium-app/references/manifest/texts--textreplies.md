<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Texts — textReplies; do not edit -->

# Manifest spec: Texts — textReplies

### textReplies

`"on"` or `"off"`: whether staff read the texts customers send back to this app. Absent means `on`.

With `off`, a reply is not kept at all, and the sender gets one fixed answer: "This number is not
read. Contact us:" and the business's phone or e-mail, in the business's language, at most once in 30
days. Use it for an app whose customers may write what nobody should hold in a shared inbox, such as
a clinic's patients writing symptoms. It is where the switch starts: the owner can turn it either way
after the install, and their choice stands across updates. See
[Conversations and replies](https://docs.adminium.dev/guides/texts/conversations/).
