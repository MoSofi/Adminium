<!-- produced from apps/docs/src/content/docs/guides/apps/guest-uploads.md § Sending the file; do not edit -->

# Guests' uploads: Sending the file

1. **Upload it.** The page sends the file on its own, before the order:
   `POST /api/v1/public/uploads?ref=<entry>&column=<column>&name=<file name>`, the body the file
   itself. A child row's column is written `<child>.<column>` (`order_lines.artwork`). The answer's
   `id` is what the order names.
2. **Name it.** The page puts the `id` in the column, in the create (and its child rows) or in a
   change of a row the guest is signed in to. In a `json` column it is one item of the list.
3. **It is the row's.** Once the write is saved, staff open the file on the record, the guest reads
   it through the entry's `files` where the entry offers it, it goes to the bin when the row lets
   go of it, and erasing the person removes it.

`@adminiumjs/public-client` sends it with `upload(ref, column, file)`:

```ts
const input = document.querySelector<HTMLInputElement>('#artwork')!;
const file = input.files![0]!;

const uploaded = await client.upload('shop_orders', 'order_lines.artwork', file);
// uploaded.id, uploaded.name, uploaded.size, uploaded.kind ('pdf', 'png', …)

await client.createTree('shop_orders', {
  values: { email },
  children: { order_lines: [{ product_id: productId, artwork: uploaded.id }] },
});
```

A guest with no session sends one proof of work for each file
([The human check](https://docs.adminium.dev/guides/apps/public-access/#the-human-check)), asked with
`GET /api/v1/public/challenge?purpose=upload`. The client solves it for you. A guest signed in to
the entry sends none.

An upload waits a day for the write that names it, and is then thrown away. Only the column it was
uploaded for takes it, so a phone that moves from Wi-Fi to mobile data in between still names it.
A write that does not stand (a refused order, a price that moved) lets its uploads wait again, so
the guest fixes the order and sends it once more without uploading the file twice.

On iPhones a photo is HEIC, which no column takes. Give the file input an `accept` that names
`image/jpeg` and `image/png` (not `image/*`), and iOS converts the photo as it is chosen.
