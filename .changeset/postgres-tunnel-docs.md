---
'@adminium/docs': patch
---

The PostgreSQL connection guide explains how to reach a database through an SSH tunnel: the `ssh -N -L` command, a key that can open that one forward and nothing else, and why the npm CLI (`npx @adminiumjs/adminium`) can use the tunnel's `127.0.0.1` while the Docker image, which runs with `NODE_ENV=production` and refuses loopback sources, needs the host's address instead. The read-write role recipe is now the recommended least-privilege role: it explains `ALTER DEFAULT PRIVILEGES FOR ROLE` for tables created by a migration role, how tables granted `SELECT` only and columns granted one by one appear in Adminium, and that the `GRANT CREATE ON DATABASE` workaround for older releases can be revoked.
