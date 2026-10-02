<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § An app you made yourself; do not edit -->

# Installing apps: An app you made yourself

An app made in [a project of your own](https://docs.adminium.dev/projects/apps/) runs from the project's folder under
`adminium dev` and `adminium start`, with nothing to upload: the installed list marks it **From this
project's folder**, and the folder, not Studio, installs, changes and removes it
([Run it from the folder](https://docs.adminium.dev/projects/apps/#run-it-from-the-folder)).

To install it on another Adminium, it installs the same way as a sideloaded one.
`adminium app pack` writes the file and its fingerprint:

```
.adminium/packs/repairs-0.1.0.tgz
.adminium/packs/repairs-0.1.0.tgz.integrity
```

Choose **Install an app**, upload the `.tgz`, and paste the contents of the `.integrity` file. From
there the install is the one described above: the database, the table check, public access and
sample data.

Such an app carries the publisher `local`, and Adminium says so. The wizard shows **Made on this
install. It does not come from adminium.dev, and nobody else has checked it.** and the installed
list marks it **Made here**. Three rules keep a self-made app from passing for anything else:

- it cannot replace an installed app from another publisher, and an app from another publisher
  cannot replace it: the upload is refused with `PUBLISHER_CHANGED`. Uninstall first, or give your
  app another key;
- it cannot take the key of an app the online catalogue lists (`KEY_IN_CATALOG`);
- the online catalogue never delivers one: a download whose manifest says `local` is discarded.

An app with no screens of its own, only tables and dashboard pages, may be installed this way when
its publisher is `local`. It is listed as installed with no sides, and is not marked **Missing**.

To keep a self-made app on a host with no persistent disk, put its `.tgz` and `.tgz.integrity` in
the folder [`ADMINIUM_BUNDLED_APPS`](https://docs.adminium.dev/self-hosting/installing-apps/#adminium_bundled_apps) names, as for any other app.
