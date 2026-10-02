<!-- produced from apps/docs/src/content/docs/guides/apps/settings.md § Extra instances; do not edit -->

# An app's settings page: Extra instances

One installed app can serve more than one database, for example two branches with a database each.
On **Studio → Hosted apps**, the **Instances** card adds one: pick the **App**, type a **URL
segment**, choose the connection it **Reads**, and **Save instances**.

An instance answers at `/apps/<key>/<segment>/staff/` and `/apps/<key>/<segment>/customer/`, and
reads only the connection you gave it. The segment cannot be `staff` or `customer`. All instances
share the one installed copy of the app, so updating the app updates every instance. The key the
install made reads only the install's own database, so an instance's customer screens need a
browser key of their own, created on the **API keys** page for that connection with the app chosen
under **App**.

A domain can open an instance: pick it under **Instance** on the **Domains** card. An instance
that a domain still opens cannot be removed until you remove that domain.
