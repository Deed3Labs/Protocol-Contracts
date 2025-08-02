# XMTP Messaging Integration

This app now includes XMTP (Extensible Message Transport Protocol) messaging capabilities, allowing users and t-deed owners to communicate directly within the application.

## Features

### 🔐 End-to-End Encrypted Messaging
- All messages are encrypted using XMTP's secure protocol
- Messages are stored locally and synced across devices
- No central server can read your messages

### 💬 Direct Communication
- Users can message t-deed owners directly from the app
- Real-time message streaming
- Conversation history and search functionality

### 🎯 T-Deed Specific Context
- Messages are automatically linked to specific t-deed assets
- Asset information (type, token ID) is included in conversations
- Easy identification of which asset the conversation is about

## How to Use

### For Users Wanting to Message T-Deed Owners

1. **Navigate to a T-Deed**: Go to the Explore page or view a specific t-deed
2. **Click "Message Owner"**: Use the XMTP message button or the message modal
3. **Connect Wallet**: If not already connected, connect your wallet
4. **Start Messaging**: Begin your conversation with the t-deed owner

### For T-Deed Owners

1. **Receive Messages**: Messages from interested users will appear in your conversations
2. **Respond**: Reply directly through the XMTP interface
3. **Manage Conversations**: View all conversations in the messaging interface

## Components

### XMTPContext (`/context/XMTPContext.tsx`)
- Manages XMTP client connections
- Handles conversation and message state
- Provides connection and messaging functions

### XMTPMessaging (`/components/XMTPMessaging.tsx`)
- Full-featured messaging interface
- Conversation list and search
- Real-time message display
- Message composition and sending

### XMTPMessageButton (`/components/XMTPMessageButton.tsx`)
- Simple button component for quick messaging
- Opens XMTP messaging modal
- Can be placed anywhere in the app

### Updated MessageOwnerModal
- Now includes XMTP messaging as the primary option
- Maintains existing Blockscan and email options
- Seamless integration with existing UI

## Technical Implementation

### Dependencies
```json
{
  "@xmtp/xmtp-js": "^13.0.4"
}
```

### Key Features
- **Automatic Connection**: Connects to XMTP when wallet is connected
- **Conversation Management**: Creates and manages conversations automatically
- **Message Streaming**: Real-time message updates
- **Error Handling**: Comprehensive error handling and user feedback
- **Responsive Design**: Works on mobile and desktop

### Security
- Uses XMTP's end-to-end encryption
- No message content stored on central servers
- Wallet-based authentication
- Secure key management

## Usage Examples

### Basic Message Button
```tsx
import XMTPMessageButton from '@/components/XMTPMessageButton';

<XMTPMessageButton
  ownerAddress="0x1234..."
  tokenId="123"
  assetType="Land"
  variant="default"
  size="sm"
/>
```

### Custom Messaging Interface
```tsx
import XMTPMessaging from '@/components/XMTPMessaging';

<XMTPMessaging
  isOpen={showMessaging}
  onClose={() => setShowMessaging(false)}
  ownerAddress="0x1234..."
  tokenId="123"
  assetType="Land"
/>
```

### Using XMTP Context
```tsx
import { useXMTP } from '@/context/XMTPContext';

const { 
  isConnected, 
  conversations, 
  sendMessage, 
  createConversation 
} = useXMTP();
```

## Network Configuration

The XMTP integration is configured for:
- **Production**: Mainnet XMTP network
- **Development**: Can be switched to testnet by changing `env: 'production'` to `env: 'dev'` in XMTPContext

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Ensure wallet is connected
   - Check network connectivity
   - Verify wallet supports XMTP

2. **Messages Not Sending**
   - Check XMTP connection status
   - Ensure recipient has XMTP enabled
   - Verify message content is valid

3. **Conversations Not Loading**
   - Refresh the page
   - Reconnect wallet
   - Check XMTP network status

### Error Messages
- "Failed to connect to XMTP": Wallet connection issue
- "Conversation not found": Invalid conversation ID
- "Failed to send message": Network or permission issue

## Future Enhancements

- [ ] Group messaging for multiple t-deed owners
- [ ] Message notifications
- [ ] File attachments
- [ ] Message reactions
- [ ] Conversation archiving
- [ ] Message search functionality
- [ ] Push notifications

## Resources

- [XMTP Documentation](https://docs.xmtp.org/)
- [XMTP GitHub](https://github.com/xmtp)
- [XMTP Chat App](https://xmtp.chat/)

## Support

For issues with XMTP integration:
1. Check the browser console for error messages
2. Verify wallet connection and network
3. Ensure XMTP is enabled for your wallet
4. Contact support with specific error details 