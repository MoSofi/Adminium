<!-- produced from apps/docs/src/content/docs/projects/deploy.md § DigitalOcean App Platform; do not edit -->

# Deploy a project: DigitalOcean App Platform

App Platform containers have **no persistent disk**, so the meta store has to be
a managed database and files need a bucket:

```yaml title=".do/app.yaml"
spec:
  name: my-admin
  services:
    - name: admin
      github:
        repo: you/my-admin
        branch: main
        deploy_on_push: true
      dockerfile_path: Dockerfile
      http_port: 4600
      instance_size_slug: basic-xxs
      instance_count: 1
      health_check:
        http_path: /api/v1/readyz
      envs:
        - key: ADMINIUM_SECRET
          scope: RUN_TIME
          type: SECRET
        - key: DATABASE_URL
          scope: RUN_TIME
          type: SECRET
        - key: ADMINIUM_STORAGE_URL
          scope: RUN_TIME
          type: SECRET
        - key: ADMINIUM_META_URL
          scope: RUN_TIME
          value: ${adminium-meta.DATABASE_URL}
  databases:
    - name: adminium-meta
      engine: PG
      production: false
```

Create it with `doctl apps create --spec .do/app.yaml`, and set the three
secrets in the control panel. `${adminium-meta.DATABASE_URL}` is DigitalOcean's
own binding for the managed database above — never point a source database at
it.

`ADMINIUM_STORAGE_URL` is required here, not optional, and it has to exist
before the first boot: point it at a Space or any other S3-compatible bucket.
One more thing the missing disk costs you: **apps and add-ons you install are
lost on every deploy**, because their packages live in the data folder. Studio
still lists them and the boot log names each one. If you install any, use a host
with a disk, or build your own image carrying those packages —
[`deploy/README.md`](https://github.com/MoSofi/Adminium/blob/main/deploy/README.md)
has the recipe.
