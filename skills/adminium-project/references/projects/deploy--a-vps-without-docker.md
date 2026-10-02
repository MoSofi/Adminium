<!-- produced from apps/docs/src/content/docs/projects/deploy.md § A VPS without Docker; do not edit -->

# Deploy a project: A VPS without Docker

Follow [A VPS without Docker](https://docs.adminium.dev/self-hosting/vps/) for Node, the meta database,
the settings file, the service and Caddy. Three things differ for a project.

**Install the project, not the package:**

```bash
sudo git clone https://github.com/you/my-admin.git /opt/my-admin
cd /opt/my-admin
sudo npm ci
sudo npm run build
```

The folder belongs to root and the service only reads it. The build has to run
on the server (or be copied there): `.adminium/` is not in git.

**Name the project in the settings file**, since the service does not start in
the folder, and add the database the admin is built from:

```bash title="/etc/adminium/adminium.env"
ADMINIUM_PROJECT_DIR=/opt/my-admin
DATABASE_URL=postgres://user:password@127.0.0.1:5432/shop
ADMINIUM_SECRET=…
ADMINIUM_META_URL=postgres://adminium:…@127.0.0.1:5432/adminium_meta
ADMINIUM_DATA_DIR=/var/lib/adminium
HOST=127.0.0.1
PORT=4600
ADMINIUM_TRUST_PROXY=on
```

`ADMINIUM_DATA_DIR` matters more here than it does without a project: unset, a
project keeps its data inside the folder, which is exactly where a deploy should
not write.

**Run the CLI from the project's own `node_modules`:**

```ini
ExecStart=/usr/bin/node /opt/my-admin/node_modules/@adminiumjs/adminium/dist/cli/index.js start
```

To deploy a change: `sudo git pull`, `sudo npm ci`, `sudo npm run build`,
`sudo systemctl restart adminium`, all in `/opt/my-admin`.
