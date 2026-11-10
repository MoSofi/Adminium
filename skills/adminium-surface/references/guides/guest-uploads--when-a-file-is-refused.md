<!-- produced from apps/docs/src/content/docs/guides/apps/guest-uploads.md § When a file is refused; do not edit -->

# Guests' uploads: When a file is refused

The upload is refused `PUBLIC_UPLOAD_REFUSED`, with `params.reason`:

| Reason | Status | What it means |
|---|---|---|
| `too-big` | 413 | Larger than the column's `upload.maxBytes`. |
| `kind` | 415 | Its bytes are not one of the column's `kinds`. |
| `cap` | 429 | This network address sent its day's files or bytes. |
| `quota` | 507 | The space kept for guests' files is full. |
| `column` | 400 | The entry takes no upload into that column. |

The write that names an upload is refused `400` `PUBLIC_WRITE_REFUSED`, with the column, when the
upload is not there for it: another column's, past its day, or already taken
(`reason: "file-not-here"`). It is also refused for a file of a kind the rule does not take
(`file-type`), one too large (`file-too-large`), or more files than `maxCount` (`too-many-files`).
See [the error codes](https://docs.adminium.dev/reference/errors/).
