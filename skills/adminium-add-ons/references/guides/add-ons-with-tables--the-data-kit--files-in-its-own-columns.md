<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § The data kit — Files in its own columns; do not edit -->

# Add-ons that keep tables of their own: The data kit — Files in its own columns

### Files in its own columns

A column of one of the add-on's tables holds files when its manifest gives it a
[`file` rule](https://docs.adminium.dev/reference/manifest/#files-in-a-column): the kinds it takes and how large one may be. A
page puts a file there with `useUpload`:

```tsx
const { upload, uploading, error } = useUpload('bases', 'outline_file');

const done = await upload(base.id, picked); // a File from an <input type="file">
if (done.removed.length > 0) say(`We removed ${done.removed.join(', ')}.`);
```

It does what a record form does, in two steps. The bytes go to the files route for that table and
column, where they are read whole: a file of a kind the column does not take is refused by what it
is (not by its name), an SVG is kept only as Adminium writes it again (a script, an event handler
or an editor's notes are taken out, and named in `removed`; a part that would draw something else,
such as a `foreignObject`, refuses the file), and a WOFF2 font, a GLB, STL or 3MF model is checked
before it is kept. Then the row is saved with the reference in the column, through every rule of
the table. That save is when the file becomes the row's.

The reader needs `update` on the table, and their role must be able to write that column. A
reader without them is refused (`403`), and so is a file the column does not take (`415`, with a
sentence that names what was wrong). A file whose save is refused is thrown away at once.

`useUpload` is absent from an Adminium older than 0.3.43. Check for it before offering an upload
(`host.data.useUpload` is undefined there), and ask for 0.3.43 in
`compatibility.minAdminiumVersion` once the add-on relies on it.
