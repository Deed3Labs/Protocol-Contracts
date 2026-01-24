# PWA Implementation Guide

## Quick Start

### 1. Update Manifest
Replace `public/manifest.json` with `public/manifest-enhanced.json`:
```bash
cp app/public/manifest-enhanced.json app/public/manifest.json
```

### 2. Update Service Worker
Replace `public/sw.js` with `public/sw-enhanced.js`:
```bash
cp app/public/sw-enhanced.js app/public/sw.js
```

### 3. Integrate Hooks

#### Push Notifications
```tsx
import { usePushNotifications } from '@/hooks/usePushNotifications';

function App() {
  const { requestPermission, showNotification } = usePushNotifications();
  
  // Request permission on mount
  useEffect(() => {
    requestPermission();
  }, []);
  
  // Use showNotification when needed
  const handleTransaction = () => {
    showNotification({
      title: 'Transaction Confirmed',
      body: 'Your transaction has been confirmed',
      tag: 'tx-confirmed'
    });
  };
}
```

#### App Badge
```tsx
import { useAppBadge } from '@/hooks/useAppBadge';

function ActivityButton() {
  const { setBadge, clearBadge } = useAppBadge();
  
  // Set badge when there are unread items
  useEffect(() => {
    setBadge(unreadCount);
  }, [unreadCount]);
  
  // Clear when user views activity
  const handleClick = () => {
    clearBadge();
    // Navigate to activity
  };
}
```

#### Share API
```tsx
import { useShare } from '@/hooks/useShare';

function PortfolioCard() {
  const { sharePortfolio } = useShare();
  
  const handleShare = () => {
    sharePortfolio({
      totalValue: 10000,
      holdings: 5,
      chains: ['Ethereum', 'Base']
    });
  };
}
```

## Features Implemented

### ✅ Enhanced Manifest
- App shortcuts for quick actions
- Multiple icon sizes
- Share target configuration
- Better metadata

### ✅ Enhanced Service Worker
- Multiple caching strategies
- Offline support
- Background sync
- Push notification support

### ✅ Push Notifications
- Real-time notifications via WebSocket
- Transaction confirmations
- Balance updates
- NFT mints/transfers

### ✅ App Badge
- Unread count indicator
- Real-time updates via WebSocket

### ✅ Share API
- Share portfolio data
- Share NFT details
- Share transactions

## Next Steps

1. **Generate Proper Icons**: Create multiple sizes (72x72, 96x96, 128x128, 192x192, 384x384, 512x512)
2. **Add Screenshots**: Add app screenshots to manifest for app stores
3. **Test Offline**: Test app functionality when offline
4. **Test Notifications**: Test push notifications on different devices
5. **Add Share Target Handler**: Create `/share` route to handle shared data

## Testing

### Test PWA Installation
1. Open app in Chrome/Edge
2. Look for install prompt
3. Install app
4. Verify it opens in standalone mode

### Test Offline
1. Open DevTools > Network
2. Set to "Offline"
3. Refresh page
4. Verify cached content loads

### Test Notifications
1. Grant notification permission
2. Trigger a transaction
3. Verify notification appears

### Test Badge
1. Install app
2. Trigger unread items
3. Verify badge appears on app icon

## Browser Support

- ✅ Chrome/Edge (Full support)
- ✅ Safari iOS (Limited - no push notifications)
- ✅ Firefox (Good support)
- ⚠️ Safari macOS (Limited PWA support)

## Performance

The enhanced Service Worker provides:
- **Faster loads**: Cached static assets
- **Offline access**: View cached data
- **Background sync**: Update data when online
- **Reduced bandwidth**: Smart caching strategies
