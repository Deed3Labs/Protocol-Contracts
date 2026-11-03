# Docker Setup Guide

## Quick Start

### Start Redis
```bash
docker-compose up -d redis
```

### Start Redis with Management UI
```bash
docker-compose --profile tools up -d
```

This will start:
- Redis on port 6379
- Redis Commander (management UI) on http://localhost:8081

### Stop Services
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f redis
```

### Access Redis CLI
```bash
docker-compose exec redis redis-cli
```

## Redis Commander

Redis Commander provides a web-based UI to browse and manage your Redis data.

Access it at: http://localhost:8081

## Data Persistence

Redis data is persisted in a Docker volume (`redis-data`). To remove all data:

```bash
docker-compose down -v
```

## Production Considerations

For production, consider:
1. Setting a Redis password
2. Using Redis Cloud or AWS ElastiCache
3. Configuring proper backup strategies
4. Setting up monitoring and alerts

### Setting Redis Password

Update `docker-compose.yml`:
```yaml
command: redis-server --appendonly yes --requirepass your-password-here
```

Then update your `.env`:
```
REDIS_PASSWORD=your-password-here
```
