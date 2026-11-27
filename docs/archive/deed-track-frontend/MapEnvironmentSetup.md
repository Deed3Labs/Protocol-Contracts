# Mapbox Environment Setup

## Environment Variables

Create a `.env` file in the `app` directory with the following structure:

```env
# Development token (for localhost/development)
VITE_MAPBOX_PUBLIC_TOKEN=your_mapbox_public_token_here

# Production token (for deployed app)
VITE_MAPBOX_PRIVATE_TOKEN=your_mapbox_private_token_here
```

## Token Types

### Public Token (Development)
- Used for localhost and development environments
- Can be exposed in browser console
- Suitable for development and testing

### Private Token (Production)
- Used for production deployments
- Should be kept secure
- Has higher rate limits and features

## Security Best Practices

1. **Never commit tokens to version control**
   - Add `.env` to your `.gitignore` file
   - Use `.env.example` for documentation only

2. **Use different tokens for different environments**
   - Development: Public token
   - Production: Private token

3. **Rotate tokens regularly**
   - Update tokens periodically for security
   - Monitor token usage in Mapbox dashboard

4. **Set appropriate token permissions**
   - Public token: Read-only access
   - Private token: Minimal required permissions

## Getting Tokens

1. Visit [https://account.mapbox.com](https://account.mapbox.com)
2. Create a free account
3. Navigate to "Access Tokens"
4. Create separate tokens for development and production
5. Copy tokens to your `.env` file

## Troubleshooting

### Token Not Working
- Verify token is correctly set in `.env` file
- Check token permissions in Mapbox dashboard
- Ensure token is valid and not expired

### Map Not Loading
- Check browser console for errors
- Verify environment variables are loaded
- Ensure token has correct permissions

### Development vs Production
- Development: Uses `VITE_MAPBOX_PUBLIC_TOKEN`
- Production: Uses `VITE_MAPBOX_PRIVATE_TOKEN`
- Environment is automatically detected 