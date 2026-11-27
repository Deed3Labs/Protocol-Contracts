# Redis for the API, locally

The API caches prices, balances and transactions in Redis, and uses it for rate limiting. It boots
without Redis, with a warning. For a local Redis, use the Docker Compose file in `apps/api`.

## Running it

From `apps/api`:

| | Command |
|---|---|
| Start Redis | `docker compose up -d redis` |
| Start Redis and Redis Commander | `docker compose --profile tools up -d` |
| Stop | `docker compose down` |
| Follow the logs | `docker compose logs -f redis` |
| Open the Redis CLI | `docker compose exec redis redis-cli` |

From the repository root, add `-f apps/api/docker-compose.yml`.

Redis listens on `localhost:6379`, with append-only persistence. Redis Commander, a web UI for
browsing the data, is at `http://localhost:8081` when started with the `tools` profile.

## Pointing the API at it

The API reads `REDIS_URL` first, then `REDIS_HOST`, `REDIS_PORT` (defaults `localhost` and `6379`)
and `REDIS_PASSWORD`. `apps/api/env.example` sets `REDIS_URL` to a sample cloud address, so for
local Redis remove that line from your `.env` or set it to `redis://localhost:6379`.

## Data

Redis data lives in the `redis-data` Docker volume and survives `docker compose down`. To remove it:

```bash
docker compose down -v
```

## Hosted Redis

A deployed API uses a hosted Redis, set with `REDIS_URL`. To run the local container with a
password, change its command in `docker-compose.yml`:

```yaml
command: redis-server --appendonly yes --requirepass <password>
```

and set the same value as `REDIS_PASSWORD` in the API's `.env`.
