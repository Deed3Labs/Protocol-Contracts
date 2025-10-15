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

### 🎯 DeedNFT Specific Context
- Messages are automatically linked to specific t-deed assets
- Asset information (type, token ID) is included in conversations
- Easy identification of which asset the conversation is about

### 🎨 Modern UI/UX Design
- **Two-Tier Header System**: Clean main header with title/description/status + action buttons subheader
- **Mobile Two-View System**: Conversation list view and individual conversation view
- **Square Send Buttons**: Perfectly centered icons in 44px square buttons
- **Vertically Centered Text**: Text inputs with proper vertical alignment
- **Responsive Design**: Optimized for both mobile and desktop experiences
- **Touch Optimizations**: Larger touch targets and proper spacing for mobile

## How to Use

### For Users Wanting to Message DeedNFT Owners

1. **Navigate to a DeedNFT**: Go to the Explore page or view a specific DeedNFT
2. **Click "Message Owner"**: Use the XMTP message button or the message modal
3. **Connect Wallet**: If not already connected, connect your wallet
4. **Start Messaging**: Begin your conversation with the DeedNFT owner

### For DeedNFT Owners

1. **Receive Messages**: Messages from interested users will appear in your conversations
2. **Respond**: Reply directly through the XMTP interface
3. **Manage Conversations**: View all conversations in the messaging interface

## Components

### XMTPContext (`/context/XMTPContext.tsx`)
- Manages XMTP client connections
- Handles conversation and message state
- Provides connection and messaging functions
- Includes `getCurrentInboxId()` for message sender identification

### XMTPMessaging (`/components/XMTPMessaging.tsx`)
- Full-featured messaging interface with modern UI/UX
- **Two-Tier Header**: Main header with title/description/status + action buttons subheader
- **Mobile Two-View System**: Conversation list view and individual conversation view
- **Square Send Buttons**: 44px × 44px square buttons with centered icons
- **Vertically Centered Text**: Text inputs with proper vertical alignment
- **Collapsible Desktop Sidebar**: Expandable conversation list (80px collapsed, 320px expanded)
- **Touch Optimizations**: Larger touch targets and proper spacing for mobile
- **Clean Message Alignment**: Sent messages on right (blue), received on left (gray)
- Real-time message display and conversation management

### XMTPMessageButton (`/components/XMTPMessageButton.tsx`)
- Simple button component for quick messaging
- Opens XMTP messaging modal
- Can be placed anywhere in the app

### Updated MessageOwnerModal
- Now includes XMTP messaging as the primary option
- Maintains existing Blockscan and email options
- Seamless integration with existing UI

## UI/UX Improvements

### Header Structure
The messaging interface features a clean, two-tier header system:

**Main Header**
- **Icon and Title**: XMTP Inbox with messaging icon
- **Description**: "Your conversations and messages"
- **Connection Status**: Real-time connection badge (Connected/Connecting/Not Connected)

**Action Buttons Subheader**
- **New DM Button**: Create new direct messages with visible text on all screen sizes
- **Sync Button**: Manually sync messages with visible text on all screen sizes
- **Close Button**: Close the messaging interface

### Mobile Experience
The mobile interface uses a modern two-view approach:

**Conversation List View**
- **Clean header** with "XMTP Inbox" title
- **Action buttons** (New DM, Sync) in header
- **Search bar** for finding conversations
- **Large conversation avatars** for better touch targets
- **Conversation count** display

**Individual Conversation View**
- **Compact header** with back button and conversation details
- **Full-width message area** for optimal reading
- **Square send button** matching input height
- **Back navigation** to conversation list

### Desktop Experience
- **Collapsible Sidebar**: Toggle between expanded (320px) and collapsed (80px) states
- **Main Chat Area**: Full-height message display with conversation header
- **Search Integration**: Built-in search functionality in sidebar
- **Smooth Transitions**: Animated transitions between sidebar states

### Message Input Features
- **Square Send Button**: 44px × 44px square with centered icon
- **Vertically Centered Text**: Text aligned to center line of input
- **Auto-Resize**: Input expands up to 120px height for longer messages
- **Enter to Send**: Press Enter to send messages quickly
- **Loading States**: Visual feedback during message sending

### Touch Optimizations
- **Larger touch targets** for better mobile usability
- **Proper spacing** between interactive elements
- **Consistent button sizing** across the interface
- **Optimized text input** with centered text alignment

## Technical Implementation

### Dependencies
```json
{
  "@xmtp/browser-sdk": "^4.0.0"
}
```

### Key Features
- **Automatic Connection**: Connects to XMTP when wallet is connected
- **Conversation Management**: Creates and manages conversations automatically
- **Message Streaming**: Real-time message updates
- **Error Handling**: Comprehensive error handling and user feedback
- **Responsive Design**: Works on mobile and desktop with optimized layouts

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
  createConversation,
  getCurrentInboxId 
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
- [ ] Message scheduling
- [ ] Message templates
- [ ] Read receipts and typing indicators

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