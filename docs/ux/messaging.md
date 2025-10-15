# XMTP Messaging - User Guide

## Overview

The Deed Protocol v0.2.0 introduces **XMTP (Extensible Message Transport Protocol)** messaging capabilities, enabling secure, end-to-end encrypted communication between users and DeedNFT owners directly within the application.

## 🔐 Security Features

### End-to-End Encryption
- **All messages are encrypted** using XMTP's secure protocol
- **No central server** can read your messages
- **Messages stored locally** and synced across devices
- **Wallet-based authentication** ensures secure access

### Privacy Protection
- **Decentralized messaging** - no central authority
- **User-controlled data** - you own your messages
- **No message metadata** stored on central servers
- **Automatic message cleanup** when switching wallets

## 💬 How to Use Messaging

### For Users Wanting to Message DeedNFT Owners

#### Step 1: Find a DeedNFT
1. Navigate to the **Explore** page
2. Browse available DeedNFTs
3. Click on a DeedNFT to view details

#### Step 2: Initiate Messaging
1. Click the **"Message Owner"** button on the DeedNFT card
2. The **MessageOwnerModal** will open with messaging options

#### Step 3: Choose Messaging Method
You have three options:

**🎯 XMTP Direct Message (Recommended)**
- Click **"XMTP Direct Message"** button
- Connect your wallet if not already connected
- Start messaging immediately

**📧 Email**
- Click **"Send Email"** button
- Opens your default email client
- Pre-filled with DeedNFT information

**🔗 Blockscan Chat**
- Click **"Open Blockscan Chat"** button
- Opens Blockscan's messaging interface
- Requires separate wallet connection

#### Step 4: XMTP Setup (First Time Only)
If the DeedNFT owner hasn't used XMTP before:

1. **Click "Set Up Secure Environment"**
   - This creates the owner's XMTP identity
   - Only needed once per DeedNFT owner

2. **Wait for setup completion**
   - Status will show "Ready to Message"
   - You can now send messages

#### Step 5: Start Messaging
1. **Type your message** in the text area
2. **Press Enter** or click **Send**
3. **Messages appear in real-time**
4. **Conversation history** is automatically saved

### For Group Conversations

#### Creating Group Chats
1. **Click "New Conversation"** in the messaging interface
2. **Select "Group Chat" tab** in the dialog
3. **Enter group name** (e.g., "Project Team")
4. **Add member addresses** (Ethereum wallet addresses)
5. **Click "Create Group"** to start the conversation

#### Group Features
- **Member Management**: Add/remove members from groups
- **Member Count Display**: Shows number of members in group
- **Optimistic Creation**: Groups created immediately, synced when members join XMTP
- **Network Sync**: Groups automatically sync to XMTP network when members become available
- **Message Broadcasting**: Send messages to all group members at once

#### Group Types
- **Real XMTP Groups**: Fully synced groups with active members
- **Optimistic Groups**: Groups waiting for members to join XMTP
- **Member Count**: Always shows current member count (e.g., "Group Chat • 5 members")

### For DeedNFT Owners

#### Receiving Messages
- **Messages appear automatically** when you connect your wallet
- **Real-time notifications** for new messages
- **Conversation history** is preserved

#### Responding to Messages
1. **Open the messaging interface**
2. **Select the conversation** from your inbox
3. **Type your response**
4. **Send immediately**

#### Managing Conversations
- **View all conversations** in the messaging interface
- **Search conversations** by address
- **Message history** is automatically synced

## 🎨 Messaging Interface

### Main Features

#### **Header Structure**
The messaging interface features a clean, two-tier header system:

**Main Header**
- **Icon and Title**: XMTP Inbox with messaging icon
- **Description**: "Your conversations and messages"
- **Connection Status**: Real-time connection badge (Connected/Connecting/Not Connected)

**Action Buttons Subheader**
- **New Conversation Button**: Create new direct messages or group chats
- **Sync Button**: Manually sync messages and optimistic groups
- **Hidden Conversations Toggle**: Show/hide archived conversations
- **Close Button**: Close the messaging interface

#### **Conversation Management**
- **Hide/Archive Conversations**: Right-click or use hide button to archive conversations
- **Hidden Conversations View**: Toggle to see archived conversations
- **Conversation Persistence**: Hidden state persists across sessions
- **Search Functionality**: Find conversations by address or name

#### **Conversation List**
- **Wallet addresses** displayed as conversation names
- **Group names** displayed for group conversations
- **Member counts** shown for all conversations (e.g., "Direct Message • 2 members")
- **Real-time updates** for new messages
- **Search functionality** to find conversations
- **Mobile responsive** design with optimized touch targets
- **Hide/Unhide buttons** for conversation management

#### **Message Composition**
- **Vertically centered text** in input fields
- **Square send buttons** with perfectly centered icons
- **Enter to send** or click send button
- **Auto-scroll** to latest messages
- **Consistent 44px height** for inputs and buttons

#### **Message Display**
- **Timestamp** for each message
- **Sender identification** (you vs. other person)
- **Message content** with proper formatting
- **Real-time updates** via streaming
- **Proper message alignment** (sent on right, received on left)

### Mobile Experience

#### **Two-View System**
The mobile interface uses a modern two-view approach:

**Conversation List View**
- **Clean header** with "XMTP Inbox" title
- **Action buttons** (New Conversation, Sync, Hidden) in header
- **Search bar** for finding conversations
- **Large conversation avatars** for better touch targets
- **Conversation count** display with member counts
- **Hide/Unhide buttons** for each conversation

**Individual Conversation View**
- **Compact header** with back button and conversation details
- **Member count display** (e.g., "Group Chat • 5 members")
- **Full-width message area** for optimal reading
- **Square send button** matching input height
- **Back navigation** to conversation list

#### **Touch Optimizations**
- **Larger touch targets** for better mobile usability
- **Proper spacing** between interactive elements
- **Consistent button sizing** across the interface
- **Optimized text input** with centered text alignment

### Desktop Experience

#### **Collapsible Sidebar**
- **Expandable conversation list** (80px collapsed, 320px expanded)
- **Search functionality** in sidebar header
- **Conversation avatars** and details
- **Smooth transitions** between states

#### **Main Chat Area**
- **Conversation header** with recipient details
- **Full-height message display** with proper scrolling
- **Message input** with square send button
- **Real-time message streaming**

## 🔧 Technical Details

### Supported Wallets
- **MetaMask** and other Web3 wallets
- **Reown AppKit** smart accounts
- **WalletConnect** compatible wallets
- **Any wallet** with XMTP support

### Network Support
- **Base Network** (primary)
- **Ethereum Mainnet** (secondary)
- **Automatic network detection**
- **Cross-network messaging** support

### Message Storage
- **Local IndexedDB** storage
- **Automatic sync** across devices
- **Offline message queuing**
- **Secure key management**

## 🚨 Troubleshooting

### Common Issues

#### **"Failed to Connect to XMTP"**
**Solution:**
1. Ensure your wallet is connected
2. Check network connectivity
3. Verify wallet supports XMTP
4. Try refreshing the page

#### **"No Messages Appearing"**
**Solution:**
1. Check XMTP connection status
2. Ensure recipient has XMTP enabled
3. Wait for sync to complete
4. Try reconnecting wallet

#### **"Conversation Not Found"**
**Solution:**
1. Refresh the page
2. Reconnect your wallet
3. Check XMTP network status
4. Contact support if persistent

#### **"Wallet Switching Issues"**
**Solution:**
1. Disconnect current wallet completely
2. Clear browser cache if needed
3. Connect new wallet
4. Messages will load automatically

### Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Failed to connect to XMTP" | Wallet connection issue | Check wallet connection |
| "Conversation not found" | Invalid conversation ID | Refresh and reconnect |
| "Failed to send message" | Network or permission issue | Check network and permissions |
| "Setup required" | DeedNFT owner needs XMTP setup | Click "Set Up Secure Environment" |

## 🔄 Sync and Performance

### Sync Strategy
- **Installation reuse** for faster subsequent connections
- **Double sync** on initial load for reliability
- **Periodic sync** every 30 seconds for updates
- **Real-time streaming** for immediate updates
- **Conversation-specific sync** when loading messages

### Performance Optimizations
- **Lazy loading** of message history
- **Pagination** for large conversations
- **Efficient caching** of conversations
- **Background sync** for new messages

## 🔮 Future Enhancements

### Planned Features
- [ ] **Message notifications** (push notifications)
- [ ] **File attachments** (images, documents)
- [ ] **Message reactions** (like, heart, etc.)
- [x] **Group messaging** for multiple owners (✅ Implemented)
- [x] **Conversation archiving** (✅ Implemented)
- [ ] **Message search** functionality
- [ ] **Message encryption** status indicators
- [ ] **Read receipts** and typing indicators
- [ ] **Message scheduling** for future delivery
- [ ] **Message templates** for common inquiries

### Advanced Features
- [ ] **Message scheduling** for future delivery
- [ ] **Message templates** for common inquiries
- [ ] **Automated responses** for DeedNFT owners
- [ ] **Message analytics** and insights
- [ ] **Integration** with other messaging platforms

## 📞 Support

### Getting Help
1. **Check this documentation** for common solutions
2. **Review browser console** for error messages
3. **Verify wallet connection** and network status
4. **Contact support** with specific error details

### Reporting Issues
When reporting issues, please include:
- **Wallet type** and version
- **Network** you're connected to
- **Browser** and version
- **Error messages** from console
- **Steps to reproduce** the issue

## 🔗 Resources

- **[XMTP Documentation](https://docs.xmtp.org/)**
- **[XMTP GitHub](https://github.com/xmtp)**
- **[XMTP Chat App](https://xmtp.chat/)**
- **[The Deed Protocol Documentation](../README.md)**

---

*This messaging feature is part of The Deed Protocol v0.2.0. For technical questions about XMTP integration, please refer to the API documentation.* 