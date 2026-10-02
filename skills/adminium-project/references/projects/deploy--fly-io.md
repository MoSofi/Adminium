<!-- produced from apps/docs/src/content/docs/projects/deploy.md § Fly.io; do not edit -->

# Deploy a project: Fly.io

```bash
fly launch --no-deploy          # writes fly.toml; it finds the Dockerfile
fly volumes create adminium_data --size 1
fly secrets set ADMINIUM_SECRET=$(openssl rand -hex 32) \
  DATABASE_URL=postgres://user:password@host:5432/shop
fly deploy
```

```toml title="fly.toml"
app = "my-admin"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[[mounts]]
  source = "adminium_data"
  destination = "/data"

[http_service]
  internal_port = 4600
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1

[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  grace_period = "40s"
  method = "get"
  path = "/api/v1/readyz"
```

A Fly volume is attached to one machine in one region and is not replicated.
Scale to a second machine and it gets its own empty volume, so stay at one — or
move the meta store to a managed database and the files to a bucket.
`fly storage create` provisions Tigris and writes the credentials Adminium's
first boot reads, with nothing else to configure.
