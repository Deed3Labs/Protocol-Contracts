# XMTP Messaging - User Guide

## Overview

The Deed Protocol v0.2.0 introduces **XMTP (Extensible Message Transport Protocol)** messaging capabilities, enabling secure, end-to-end encrypted communication between users and T-Deed owners directly within the application.

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

### For Users Wanting to Message T-Deed Owners

#### Step 1: Find a T-Deed
1. Navigate to the **Explore** page
2. Browse available T-Deeds
3. Click on a T-Deed to view details

#### Step 2: Initiate Messaging
1. Click the **"Message Owner"** button on the T-Deed card
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
- Pre-filled with T-Deed information

**🔗 Blockscan Chat**
- Click **"Open Blockscan Chat"** button
- Opens Blockscan's messaging interface
- Requires separate wallet connection

#### Step 4: XMTP Setup (First Time Only)
If the T-Deed owner hasn't used XMTP before:

1. **Click "Set Up Secure Environment"**
   - This creates the owner's XMTP identity
   - Only needed once per T-Deed owner

2. **Wait for setup completion**
   - Status will show "Ready to Message"
   - You can now send messages

#### Step 5: Start Messaging
1. **Type your message** in the text area
2. **Press Enter** or click **Send**
3. **Messages appear in real-time**
4. **Conversation history** is automatically saved

### For T-Deed Owners

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

#### **Conversation List**
- **Wallet addresses** displayed as conversation names
- **Real-time updates** for new messages
- **Search functionality** to find conversations
- **Mobile responsive** design

#### **Message Composition**
- **Rich text support** for message content
- **Enter to send** or click send button
- **Auto-scroll** to latest messages
- **Typing indicators** (future feature)

#### **Message Display**
- **Timestamp** for each message
- **Sender identification** (you vs. other person)
- **Message content** with proper formatting
- **Real-time updates** via streaming

### Mobile Experience
- **Touch-optimized** interface
- **Swipe gestures** for navigation
- **Responsive design** for all screen sizes
- **Keyboard-friendly** input

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
| "Setup required" | T-Deed owner needs XMTP setup | Click "Set Up Secure Environment" |

## 🔄 Sync and Performance

### Sync Strategy
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
- [ ] **Group messaging** for multiple owners
- [ ] **Message search** functionality
- [ ] **Conversation archiving**
- [ ] **Message encryption** status indicators
- [ ] **Read receipts** and typing indicators

### Advanced Features
- [ ] **Message scheduling** for future delivery
- [ ] **Message templates** for common inquiries
- [ ] **Automated responses** for T-Deed owners
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