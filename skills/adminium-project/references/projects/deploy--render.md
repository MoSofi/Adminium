<!-- produced from apps/docs/src/content/docs/projects/deploy.md § Render; do not edit -->

# Deploy a project: Render

Commit a Blueprint next to the project and create the service from it:

```yaml title="render.yaml"
services:
  - type: web
    name: my-admin
    runtime: docker
    dockerfilePath: ./Dockerfile
    plan: starter
    healthCheckPath: /api/v1/readyz
    envVars:
      - key: ADMINIUM_SECRET
        generateValue: true
      - key: DATABASE_URL
        sync: false
    disk:
      name: adminium-data
      mountPath: /data
      sizeGB: 1
```

`generateValue` mints the secret once and keeps it stable across deploys, which
is the one property the meta store's encryption depends on. `sync: false` makes
Render ask you for the database URL instead of keeping it in the repository. The
disk holds Adminium's own database, your files and any installed apps and
add-ons; keep it even if you move the meta store to a managed PostgreSQL.
