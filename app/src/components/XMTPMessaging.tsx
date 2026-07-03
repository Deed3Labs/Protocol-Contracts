import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useXMTP } from '@/context/XMTPContext';
import { useXMTPConnection } from '@/hooks/useXMTPConnection';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  MessageCircle, 
  Send, 
  User, 
  Loader2, 
  AlertCircle,
  X,
  Search,
  RefreshCw,
  Plus,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Archive,
  Users,
  Check,
  Copy,
  Share2,
  Pencil,
  UserPlus,
  Trash2
} from 'lucide-react';
import { motion, type PanInfo } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useContacts, contactInitials } from '@/context/ContactsContext';

/**
 * Swipe-left conversation row (Apple Mail style): dragging left reveals Archive + Delete actions.
 * The row itself stays tappable (to open the thread) when not dragged. Snaps open/closed on release.
 */
function SwipeableRow({
  archiveIcon,
  archiveLabel,
  onArchive,
  onDelete,
  children,
}: {
  archiveIcon: React.ReactNode;
  archiveLabel: string;
  onArchive: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative overflow-hidden">
      {/* action panel revealed behind the row */}
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={() => { setOpen(false); onArchive(); }}
          className="flex w-[76px] flex-col items-center justify-center gap-0.5 bg-amber-500 text-[11px] font-medium text-white"
        >
          {archiveIcon}
          {archiveLabel}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); onDelete(); }}
          className="flex w-[76px] flex-col items-center justify-center gap-0.5 bg-negative text-[11px] font-medium text-white"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
      <motion.div
        drag="x"
        dragConstraints={{ left: -152, right: 0 }}
        dragElastic={{ left: 0.05, right: 0.25 }}
        animate={{ x: open ? -152 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 42 }}
        onDragEnd={(_e, info: PanInfo) => {
          setOpen(info.offset.x < -60 || info.velocity.x < -400 ? info.offset.x < 0 : false);
        }}
        className="relative touch-pan-y bg-card"
      >
        {children}
      </motion.div>
    </div>
  );
}

interface XMTPMessagingProps {
  ownerAddress?: string;
  tokenId?: string;
  assetType?: string;
  isOpen: boolean;
  onClose: () => void;
  initialConversationId?: string | null;
  /** When opening to message a specific person (e.g. from Contacts), prefill the New DM flow. */
  initialComposeAddress?: string | null;
}

const XMTPMessaging: React.FC<XMTPMessagingProps> = ({
  ownerAddress,
  tokenId,
  assetType,
  isOpen,
  onClose,
  initialConversationId,
  initialComposeAddress,
}) => {
  const { 
    conversations, 
    messages, 
    isLoading, 
    error, 
    sendMessage, 
    loadMessages, 
    loadConversations,
    createConversation,
    createGroupConversation,
    updateGroupName,
    syncOptimisticGroups,
    manualSync,
    canMessage,
    getCurrentInboxId,
    deleteConversation,
    isConnected
  } = useXMTP();
  
  const { handleConnect, isConnecting, isEmbeddedWallet, address } = useXMTPConnection();
  const { contacts, lookupWallet } = useContacts();
  const contactsWithWallet = contacts.filter((c) => c.wallet);

  const [selectedConversation, setSelectedConversation] = useState<string | null>(initialConversationId || null);

  // Update selected conversation when initialConversationId changes
  useEffect(() => {
    if (isOpen && initialConversationId) {
      setSelectedConversation(initialConversationId);
      loadMessages(initialConversationId);
    }
  }, [isOpen, initialConversationId, loadMessages]);

  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newDmAddress, setNewDmAddress] = useState('');
  const [isCreatingDm, setIsCreatingDm] = useState(false);
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);
  const [conversationType, setConversationType] = useState<'dm' | 'group'>('dm');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>(['']);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  // When a recipient email/phone isn't a Clear member yet, we surface an invite instead of failing.
  const [inviteRecipient, setInviteRecipient] = useState<string | null>(null);
  // When a recipient IS a member but hasn't turned on messaging, we nudge instead of failing.
  const [notReachableName, setNotReachableName] = useState<string | null>(null);
  // Friendly names for conversations, keyed by conversation id (XMTP ids are opaque hashes).
  const [conversationNames, setConversationNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('xmtp_conversation_names') || '{}');
    } catch {
      return {};
    }
  });
  // Inline group-rename dialog (any member can rename a group).
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [isRenamingGroup, setIsRenamingGroup] = useState(false);
  const [currentUserInboxId, setCurrentUserInboxId] = useState<string | null>(null);
  const [isConversationListCollapsed, setIsConversationListCollapsed] = useState(false);
  const [hiddenConversations, setHiddenConversations] = useState<Set<string>>(new Set());
  const [deletedConversations, setDeletedConversations] = useState<Set<string>>(new Set());
  const [showHiddenConversations, setShowHiddenConversations] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // Resolved peer wallet per DM conversation id — lets us title a DM by the contact's name even when
  // it was loaded from the network (not created this session, so no cached name).
  const [peerAddresses, setPeerAddresses] = useState<Record<string, string>>({});
  // Message scroll containers (mobile + desktop layouts) — we scroll whichever is visible to the bottom.
  const msgScrollMobileRef = useRef<HTMLDivElement>(null);
  const msgScrollDesktopRef = useRef<HTMLDivElement>(null);

  // Opening to message a specific person (e.g. from Contacts): auto-create the DM and jump
  // straight into the thread. Falls back to the prefilled New DM dialog if not connected or the
  // address can't be reached. Guarded by a ref so it runs once per open/address (no churn).
  const composedAddressRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      composedAddressRef.current = null;
      return;
    }
    if (!initialComposeAddress || composedAddressRef.current === initialComposeAddress) return;
    composedAddressRef.current = initialComposeAddress;

    const prefillDialog = () => {
      setConversationType('dm');
      setNewDmAddress(initialComposeAddress);
      setShowNewConversationDialog(true);
    };
    if (!isConnected) {
      prefillDialog();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const convo = await createConversation(initialComposeAddress);
        if (cancelled) return;
        await loadConversations();
        setSelectedConversation(convo.id);
        await loadMessages(convo.id);
      } catch (err) {
        if (cancelled) return;
        console.warn('XMTP: auto-compose failed, opening New DM dialog instead:', err);
        prefillDialog();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, initialComposeAddress, isConnected, createConversation, loadConversations, loadMessages]);

  // Manual sync handler
  const handleManualSync = useCallback(() => {
    console.log('XMTP: Manual sync triggered by user');
    return manualSync();
  }, [manualSync]);

  // Dedicated auto-sync function with stable dependencies
  const performAutoSync = useCallback(async () => {
    if (!isConnected) return;
    
    console.log('XMTP: Auto sync triggered');
    setIsAutoSyncing(true);
    
    try {
      // Sync conversations
      await loadConversations();
      
      // Sync optimistic groups
      await syncOptimisticGroups();
      
      console.log('XMTP: Auto sync completed successfully');
    } catch (error) {
      console.error('XMTP: Auto sync failed:', error);
    } finally {
      setIsAutoSyncing(false);
    }
  }, [isConnected]); // Only depend on isConnected, not the functions themselves

  // Debug logging for current user address
  useEffect(() => {
    console.log('XMTP: Current user address debug:', {
      address,
      isConnected,
      isConnecting
    });
  }, [address, isConnected, isConnecting]);
  
  // Load current user's inbox ID when connected
  useEffect(() => {
    if (isConnected && !currentUserInboxId) {
      getCurrentInboxId().then((inboxId) => {
        console.log('XMTP: Current user inbox ID:', inboxId);
        setCurrentUserInboxId(inboxId);
      }).catch((err) => {
        console.error('XMTP: Failed to get current inbox ID:', err);
      });
    }
  }, [isConnected, currentUserInboxId, getCurrentInboxId]);

  // Auto-scroll to the newest message (on send, receive, or switching threads). We scroll the message
  // container directly — the mobile + desktop layouts are both mounted, so scroll whichever is visible
  // (the hidden one is a harmless no-op). rAF waits for the new message to lay out before scrolling.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      for (const el of [msgScrollMobileRef.current, msgScrollDesktopRef.current]) {
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedConversation, selectedConversation ? messages[selectedConversation]?.length : 0]);

  // Auto-connect only once per modal open to avoid infinite loop (handleConnect identity changes every render)
  const autoConnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      autoConnectAttemptedRef.current = false;
      return;
    }
    if (isConnected || isConnecting || autoConnectAttemptedRef.current) return;
    autoConnectAttemptedRef.current = true;
    console.log('XMTP: Modal opened, attempting XMTP connect once...');
    handleConnect().catch((err) => {
      console.error('XMTP: Failed to connect when modal opened:', err);
    });
  }, [isOpen, isConnected, isConnecting]);

  // Auto-create conversation with owner if provided
  const [autoCreationAttempted, setAutoCreationAttempted] = useState(false);
  
  useEffect(() => {
    console.log('XMTP: Auto-creation check:', { 
      isConnected, 
      ownerAddress, 
      conversationsLength: conversations.length,
      autoCreationAttempted
    });
    
    // Only attempt auto-creation once per modal session
    if (isConnected && ownerAddress && !autoCreationAttempted) {
      console.log('XMTP: Auto-creating conversation with owner:', ownerAddress);
      setAutoCreationAttempted(true);
      
      createConversation(ownerAddress).then((conversation) => {
        console.log('XMTP: Auto-created conversation:', conversation.id);
        setSelectedConversation(conversation.id);
        loadMessages(conversation.id);
      }).catch((err) => {
        console.error('XMTP: Failed to auto-create conversation:', err);
        // Reset the flag so user can try again
        setAutoCreationAttempted(false);
      });
    }
  }, [isConnected, ownerAddress, autoCreationAttempted, createConversation, loadMessages, conversations.length]);
  
  // Reset auto-creation flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAutoCreationAttempted(false);
    }
  }, [isOpen]);

  // Load hidden + deleted conversations from localStorage
  useEffect(() => {
    const savedHidden = localStorage.getItem('xmtp-hidden-conversations');
    if (savedHidden) {
      try {
        setHiddenConversations(new Set(JSON.parse(savedHidden)));
      } catch (err) {
        console.error('Failed to load hidden conversations:', err);
      }
    }
    const savedDeleted = localStorage.getItem('xmtp-deleted-conversations');
    if (savedDeleted) {
      try {
        setDeletedConversations(new Set(JSON.parse(savedDeleted)));
      } catch (err) {
        console.error('Failed to load deleted conversations:', err);
      }
    }
  }, []);

  // Resolve each DM's peer wallet (from its XMTP members) so we can title it by the contact's name,
  // even for conversations loaded from the network. Best-effort + cached, so it runs once per DM.
  useEffect(() => {
    if (!isConnected || !currentUserInboxId || conversations.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const conv of conversations) {
        if (cancelled) break;
        if (isGroupConversation(conv.id) || peerAddresses[conv.id]) continue;
        try {
          const members = await (conv as any).members?.();
          if (!members || cancelled) continue;
          const peer = members.find((m: any) => m.inboxId && m.inboxId !== currentUserInboxId);
          const addr: string | undefined = peer?.accountIdentifiers?.[0]?.identifier;
          if (addr) setPeerAddresses((prev) => (prev[conv.id] ? prev : { ...prev, [conv.id]: addr }));
        } catch { /* ignore — falls back to the conversation id */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, conversations, currentUserInboxId]);

  // Unified auto-sync system
  useEffect(() => {
    if (!isConnected) return;

    console.log('XMTP: Setting up auto-sync system...');
    
    // Initial sync after 250ms to ensure everything is loaded
    const initialSyncTimer = setTimeout(() => {
      console.log('XMTP: Performing initial auto-sync...');
      performAutoSync();
    }, 250);

    // Periodic sync every 30 seconds
    const syncInterval = setInterval(() => {
      console.log('XMTP: Performing periodic auto-sync...');
      performAutoSync();
    }, 30000);

    return () => {
      console.log('XMTP: Cleaning up auto-sync timers...');
      clearTimeout(initialSyncTimer);
      clearInterval(syncInterval);
    };
  }, [isConnected, performAutoSync]);

  // Save hidden conversations to localStorage
  const saveHiddenConversations = (hidden: Set<string>) => {
    try {
      localStorage.setItem('xmtp-hidden-conversations', JSON.stringify([...hidden]));
    } catch (err) {
      console.error('Failed to save hidden conversations:', err);
    }
  };

  // Hide a conversation
  const hideConversation = (conversationId: string) => {
    const newHidden = new Set(hiddenConversations);
    newHidden.add(conversationId);
    setHiddenConversations(newHidden);
    saveHiddenConversations(newHidden);
  };

  // Unhide a conversation
  const unhideConversation = (conversationId: string) => {
    const newHidden = new Set(hiddenConversations);
    newHidden.delete(conversationId);
    setHiddenConversations(newHidden);
    saveHiddenConversations(newHidden);
  };

  // Permanently delete a conversation from view. XMTP conversations reload from the network, so we
  // persist the deleted ids and filter them out on every load (plus drop it from the current session).
  const removeConversation = (conversationId: string) => {
    const next = new Set(deletedConversations);
    next.add(conversationId);
    setDeletedConversations(next);
    try {
      localStorage.setItem('xmtp-deleted-conversations', JSON.stringify([...next]));
    } catch (err) {
      console.error('Failed to save deleted conversations:', err);
    }
    if (selectedConversation === conversationId) setSelectedConversation(null);
    void deleteConversation(conversationId);
  };

  // Handle creating new group
  const handleCreateGroup = async () => {
    if (!groupName.trim() || groupMembers.length === 0) return;

    setIsCreatingGroup(true);
    try {
      // Members can be entered as email, phone, or wallet — resolve each to a wallet address.
      const entries = groupMembers.map((m) => m.trim()).filter(Boolean);
      const wallets: string[] = [];
      const unresolved: string[] = [];
      for (const entry of entries) {
        const resolved = await resolveRecipient(entry);
        if (resolved && 'wallet' in resolved) wallets.push(resolved.wallet);
        else unresolved.push(entry);
      }

      if (wallets.length === 0) {
        alert('Add at least one member by email, phone, or wallet address.');
        return;
      }
      if (unresolved.length > 0) {
        const proceed = confirm(
          `These aren't Clear members yet and will be skipped:\n${unresolved.join('\n')}\n\nCreate the group with the others?`,
        );
        if (!proceed) return;
      }

      console.log('XMTP: Creating new group:', { name: groupName, members: wallets });
      const conversation = await createGroupConversation(groupName, wallets);
      console.log('XMTP: Created group conversation:', conversation.id);
      rememberConversationName(conversation.id, groupName.trim());

      await loadConversations();
      setSelectedConversation(conversation.id);
      await loadMessages(conversation.id);

      setShowNewConversationDialog(false);
      setGroupName('');
      setGroupMembers(['']);
    } catch (err) {
      console.error('XMTP: Failed to create new group:', err);
      alert(err instanceof Error ? err.message : 'Failed to create group. Please check the members and try again.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  // Add group member field
  const addGroupMember = () => {
    setGroupMembers([...groupMembers, '']);
  };

  // Remove group member field
  const removeGroupMember = (index: number) => {
    if (groupMembers.length > 1) {
      const newMembers = groupMembers.filter((_, i) => i !== index);
      setGroupMembers(newMembers);
    }
  };

  // Update group member address
  const updateGroupMember = (index: number, address: string) => {
    const newMembers = [...groupMembers];
    newMembers[index] = address;
    setGroupMembers(newMembers);
  };

  // Persist a friendly name for a conversation so the list/header never show a raw hash or address.
  const rememberConversationName = useCallback((conversationId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setConversationNames((prev) => {
      const next = { ...prev, [conversationId]: trimmed };
      try { localStorage.setItem('xmtp_conversation_names', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const normalizePhone = (v?: string | null) => (v || '').replace(/[^0-9]/g, '');

  const detectRecipientType = (v: string): 'address' | 'email' | 'phone' | 'unknown' => {
    const s = v.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(s)) return 'address';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'email';
    if (/^\+?[0-9][0-9\s\-().]{6,}$/.test(s)) return 'phone';
    return 'unknown';
  };

  // Resolve a human-friendly recipient (email / phone / wallet) to a wallet address + display name.
  // Checks local contacts first (instant, offline), then the member directory. Returns { notMember }
  // when an email/phone maps to no Clear member, so the caller can offer an invite instead of failing.
  const resolveRecipient = async (
    raw: string,
  ): Promise<{ wallet: string; name?: string } | { notMember: true } | null> => {
    const s = raw.trim();
    const kind = detectRecipientType(s);
    if (kind === 'unknown') return null;
    if (kind === 'address') {
      const c = contacts.find((c) => c.wallet?.toLowerCase() === s.toLowerCase());
      return { wallet: s, name: c?.name };
    }
    const contact = contacts.find((c) =>
      kind === 'email'
        ? c.email?.toLowerCase() === s.toLowerCase()
        : normalizePhone(c.phone) === normalizePhone(s),
    );
    if (contact?.wallet) return { wallet: contact.wallet, name: contact.name };
    // Use the contacts hook's lookup (scoped to the authed SMART wallet) — not the XMTP EOA, which the
    // backend's requireWalletMatch would reject ("wallet does not match authenticated wallet").
    const found = await lookupWallet(kind === 'email' ? { email: s } : { phone: s });
    if (found) return { wallet: found, name: contact?.name };
    return { notMember: true };
  };

  // Invite (for non-members): a shareable link + prefilled message they can copy or share natively.
  const inviteLink = typeof window !== 'undefined' ? window.location.origin : 'https://app.useclear.org';
  const inviteMessage = `Join me on Clear so we can message securely and move money: ${inviteLink}`;
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteMessage); } catch { /* ignore */ }
  };
  const shareInvite = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: 'Join me on Clear', text: inviteMessage, url: inviteLink });
        return;
      } catch { /* user cancelled or unsupported — fall back to copy */ }
    }
    copyInvite();
  };

  // A single source of truth for what a conversation is called. Groups prefer their (editable) XMTP
  // name; DMs prefer the contact/looked-up name captured when the chat was started.
  const getConversationTitle = (conv: any): string => {
    const id = typeof conv === 'string' ? conv : conv?.id;
    if (!id) return 'Conversation';
    if (isGroupConversation(id)) {
      const convObj = typeof conv === 'object' && conv ? conv : conversations.find((c) => c.id === id);
      const native = convObj && typeof (convObj as any).name === 'string' ? (convObj as any).name.trim() : '';
      return native || conversationNames[id] || getGroupMetadata(id)?.name || 'Group Chat';
    }
    // DMs: prefer a captured name, then the peer's contact name (resolved live from their wallet), then
    // the peer's address, and only fall back to the opaque conversation id if we know nothing else.
    const peer = peerAddresses[id];
    const contactName = peer
      ? contacts.find((c) => c.wallet?.toLowerCase() === peer.toLowerCase())?.name
      : undefined;
    return conversationNames[id] || contactName || (peer ? formatAddress(peer) : formatAddress(id));
  };

  const openRenameGroup = (conversationId: string) => {
    setRenameGroupId(conversationId);
    setRenameGroupValue(getConversationTitle(conversationId));
  };
  const submitRenameGroup = async () => {
    if (!renameGroupId || !renameGroupValue.trim()) return;
    setIsRenamingGroup(true);
    try {
      await updateGroupName(renameGroupId, renameGroupValue.trim());
      rememberConversationName(renameGroupId, renameGroupValue.trim());
      setRenameGroupId(null);
    } catch (err) {
      console.error('XMTP: Failed to rename group:', err);
      alert('Could not rename the group. Please try again.');
    } finally {
      setIsRenamingGroup(false);
    }
  };

  // Handle creating new DM
  const handleCreateNewDm = async () => {
    const raw = newDmAddress.trim();
    if (!raw) return;

    setInviteRecipient(null);
    setNotReachableName(null);
    setIsCreatingDm(true);
    try {
      const resolved = await resolveRecipient(raw);
      if (!resolved) {
        alert('Enter an email, phone number, or wallet address.');
        return;
      }
      // Not a Clear member yet → offer an invite instead of a dead end.
      if ('notMember' in resolved) {
        setInviteRecipient(raw);
        return;
      }

      const { wallet, name } = resolved;
      console.log('XMTP: Creating new DM with wallet:', wallet, 'name:', name);

      // Member exists but hasn't enabled messaging → nudge, don't fail silently.
      const isReachable = await canMessage(wallet);
      if (!isReachable) {
        setNotReachableName(name || raw);
        return;
      }

      const conversation = await createConversation(wallet);
      console.log('XMTP: Created new DM:', conversation.id);
      if (name) rememberConversationName(conversation.id, name);

      await loadConversations();
      setSelectedConversation(conversation.id);
      await loadMessages(conversation.id);

      setShowNewConversationDialog(false);
      setNewDmAddress('');
    } catch (err) {
      console.error('XMTP: Failed to create new DM:', err);
      alert('Failed to start the conversation. Please try again.');
    } finally {
      setIsCreatingDm(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      console.log('XMTP: handleSendMessage called with selectedConversation:', selectedConversation);

      // If no conversation is selected but we have an owner address, create one
      if (!selectedConversation && ownerAddress) {
        console.log('XMTP: No conversation selected, creating one with owner:', ownerAddress);
        
        try {
          const conversation = await createConversation(ownerAddress);
          console.log('XMTP: Created conversation:', conversation.id);
          setSelectedConversation(conversation.id);
          
          // Reload conversations to ensure the new one appears in the UI
          await loadConversations();
          await loadMessages(conversation.id);
          
          // Now send the message using the normal sendMessage function
          console.log('XMTP: Sending message to newly created conversation:', conversation.id);
          await sendMessage(conversation.id, newMessage.trim());
          setNewMessage('');
          return;
        } catch (createErr) {
          console.error('XMTP: Failed to create conversation in handleSendMessage:', createErr);
          // Don't clear the message so user can try again
          return;
        }
      }

      if (!selectedConversation) {
        console.error('No conversation selected and no owner address provided');
        return;
      }

      console.log('XMTP: Sending message to conversation:', selectedConversation);
      await sendMessage(selectedConversation, newMessage.trim());
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Determine if a conversation is a group by checking localStorage metadata and conversation type
  const isGroupConversation = (conversationId: string) => {
    try {
      // First check if it's a real XMTP group by looking at the conversation
      const conversation = conversations.find(c => c.id === conversationId);
      if (conversation) {
        // Check if it's a Group instance (real XMTP group)
        const isRealGroup = conversation.constructor.name === 'Group';
        if (isRealGroup) {
          console.log('XMTP: Found real XMTP group:', conversationId);
          return true;
        }
      }
      
      // Then check localStorage for our stored group metadata (optimistic groups)
      const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      const isStoredGroup = groups.some((group: any) => group.id === conversationId && group.type === 'group');
      
      if (isStoredGroup) {
        console.log('XMTP: Found optimistic group in localStorage:', conversationId);
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error checking group conversation:', err);
      return false;
    }
  };

  // Get group metadata for display
  const getGroupMetadata = (conversationId: string) => {
    try {
      const groups = JSON.parse(localStorage.getItem('xmtp-groups') || '[]');
      return groups.find((group: any) => group.id === conversationId && group.type === 'group');
    } catch (err) {
      console.error('Error getting group metadata:', err);
      return null;
    }
  };

  // Get conversation members count for display (works for both DMs and groups)
  const getConversationMembersCount = (conversationId: string) => {
    try {
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation) return 0;

      // Debug logging
      console.log('XMTP: Getting member count for conversation:', {
        conversationId,
        conversationType: conversation.constructor.name,
        isGroup: isGroupConversation(conversationId),
        conversationKeys: Object.keys(conversation)
      });

      // Check if it's a group conversation first
      if (isGroupConversation(conversationId)) {
        // For real XMTP groups, try to get actual member count
        if (conversation.constructor.name === 'Group') {
          try {
            // Try to get members from the group object (this might not work in all cases)
            const metadata = getGroupMetadata(conversationId);
            if (metadata && metadata.members) {
              return metadata.members.length;
            }
            // Fallback: assume at least 2 members for a group (creator + 1 member)
            return 2;
          } catch (err) {
            console.warn('Could not get group members count:', err);
            return 2; // Fallback
          }
        }

        // For optimistic groups, use stored metadata
        const metadata = getGroupMetadata(conversationId);
        if (metadata && metadata.members) {
          return metadata.members.length;
        }

        // Fallback for groups
        return 2;
      }

      // If it's not a group, it's a DM - always 1 member (just the recipient, excluding sender)
      console.log('XMTP: Conversation is a DM, returning 1 member');
      return 1;
    } catch (err) {
      console.error('Error getting conversation members count:', err);
      return 0;
    }
  };

  // Get the actual conversation type for debugging
  const getConversationType = (conversationId: string) => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return 'Unknown';
    
    const isRealGroup = conversation.constructor.name === 'Group';
    const metadata = getGroupMetadata(conversationId);
    
    if (isRealGroup) return 'Real XMTP Group';
    if (metadata) return 'Optimistic Group';
    return 'Direct Message';
  };

  // Friendly one-liner under a conversation title. DMs are just "Direct message" (no member count —
  // it was always "1 members"); groups show a correctly-pluralised member count.
  const conversationSubtitle = (conversationId: string) => {
    if (getConversationType(conversationId) === 'Direct Message') return 'Direct message';
    const n = getConversationMembersCount(conversationId);
    return `Group · ${n} member${n === 1 ? '' : 's'}`;
  };

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diffInHours = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      // Today - show time
      return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 48) {
      // Yesterday
      return 'Yesterday';
    } else {
      // Older - show date
      return timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const filteredConversations = conversations.filter(conversation => {
    if (deletedConversations.has(conversation.id)) return false; // permanently removed
    // Search by the resolved title (name/peer) as well as the raw id, so name search works.
    const q = searchQuery.toLowerCase();
    const matchesSearch = conversation.id.toLowerCase().includes(q) || getConversationTitle(conversation).toLowerCase().includes(q);
    const isHidden = hiddenConversations.has(conversation.id);

    if (showHiddenConversations) {
      return matchesSearch && isHidden;
    } else {
      return matchesSearch && !isHidden;
    }
  });
  
  const currentMessages = selectedConversation ? messages[selectedConversation] || [] : [];

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-0 sm:p-4">
        <div className="bg-card rounded-none sm:rounded-sm shadow-xl w-full h-full sm:max-w-6xl sm:h-[95vh] sm:max-h-[95vh] flex flex-col">
        {/* Header — title + connection status on the left, actions on the right (single row) */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center space-x-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info/10 text-info">
                <MessageCircle className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold leading-tight text-foreground">
                  {ownerAddress ? 'Messaging' : 'Messages'}
                </h2>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground truncate">
                  {ownerAddress ? (
                    <>{assetType} #{tokenId} • {formatAddress(ownerAddress)}</>
                  ) : isConnected ? (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
                      {isEmbeddedWallet ? 'Connected · Smart Account' : 'Connected'}
                    </>
                  ) : isConnecting ? (
                    <>
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      Not connected
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* New Conversation Button */}
              {isConnected && (
                <Dialog open={showNewConversationDialog} onOpenChange={setShowNewConversationDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="px-3 bg-background">
                      <Plus className="w-4 h-4 mr-0" />
                      <span className="hidden sm:inline">New Conversation</span>
                      <span className="sm:hidden">New</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent overlayClassName="z-[110]" className="z-[120] w-[calc(100vw-2rem)] max-w-lg mx-auto rounded-sm border-border">
                    <DialogHeader>
                      <DialogTitle>Create New Conversation</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      {/* Tab Navigation */}
                      <div className="flex border-b border-border">
                        <button
                          onClick={() => setConversationType('dm')}
                          className={cn(
                            "flex-1 py-2 px-4 text-sm font-medium border-b-2 transition-colors",
                            conversationType === 'dm'
                              ? "border-info text-info"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <div className="flex items-center justify-center space-x-2">
                            <MessageCircle className="w-4 h-4" />
                            <span>Direct Message</span>
                          </div>
                        </button>
                        <button
                          onClick={() => setConversationType('group')}
                          className={cn(
                            "flex-1 py-2 px-4 text-sm font-medium border-b-2 transition-colors",
                            conversationType === 'group'
                              ? "border-info text-info"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <div className="flex items-center justify-center space-x-2">
                            <Users className="w-4 h-4" />
                            <span>Group Chat</span>
                          </div>
                        </button>
                      </div>

                      {/* DM Tab Content */}
                      {conversationType === 'dm' && (
                        <div className="space-y-4">
                          {contactsWithWallet.length > 0 && (
                            <div>
                              <label className="block text-sm font-medium text-foreground mb-2">From your contacts</label>
                              <div className="max-h-40 space-y-1 overflow-y-auto">
                                {contactsWithWallet.map((c) => {
                                  const active = newDmAddress.trim().toLowerCase() === c.wallet!.toLowerCase();
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => setNewDmAddress(c.wallet!)}
                                      className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                                        active ? 'border-foreground bg-secondary/50' : 'border-border hover:bg-secondary/40',
                                      )}
                                    >
                                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                                        {contactInitials(c.name)}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                                      </span>
                                      {active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Email, phone, or wallet address
                            </label>
                            <Input
                              placeholder="name@email.com, +1 555 000 1234, or 0x…"
                              value={newDmAddress}
                              onChange={(e) => {
                                setNewDmAddress(e.target.value);
                                if (inviteRecipient) setInviteRecipient(null);
                                if (notReachableName) setNotReachableName(null);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNewDm(); }}
                              className="text-sm bg-background"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              We’ll find them by email or phone — no wallet address needed.
                            </p>
                          </div>

                          {inviteRecipient && (
                            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                              <div className="flex items-start gap-2">
                                <UserPlus className="w-4 h-4 mt-0.5 text-info shrink-0" />
                                <p className="text-sm text-foreground">
                                  <span className="font-medium break-all">{inviteRecipient}</span> isn’t on Clear yet. Send them an invite to start the conversation.
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={copyInvite} className="flex-1 bg-background border-border">
                                  <Copy className="w-4 h-4 mr-1" /> Copy invite
                                </Button>
                                <Button size="sm" onClick={shareInvite} className="flex-1 bg-primary text-primary-foreground hover:opacity-90 border border-primary">
                                  <Share2 className="w-4 h-4 mr-1" /> Share
                                </Button>
                              </div>
                            </div>
                          )}

                          {notReachableName && (
                            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                              <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 mt-0.5 text-info shrink-0" />
                                <p className="text-sm text-foreground">
                                  <span className="font-medium break-all">{notReachableName}</span> is on Clear but hasn’t turned on secure messaging yet. Ask them to open Messages once, then try again.
                                </p>
                              </div>
                              <Button variant="outline" size="sm" onClick={shareInvite} className="w-full bg-background border-border">
                                <Share2 className="w-4 h-4 mr-1" /> Send them a nudge
                              </Button>
                            </div>
                          )}
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowNewConversationDialog(false);
                                setNewDmAddress('');
                                setConversationType('dm');
                              }}
                              className="border-border bg-background"
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleCreateNewDm}
                              disabled={!newDmAddress.trim() || isCreatingDm}
                              className="bg-primary hover:opacity-90 text-primary-foreground border border-primary"
                            >
                              {isCreatingDm ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-0 animate-spin" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <MessageCircle className="w-4 h-4 mr-0" />
                                  Create DM
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Group Tab Content */}
                      {conversationType === 'group' && (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Group Name
                            </label>
                            <Input
                              placeholder="Enter group name..."
                              value={groupName}
                              onChange={(e) => setGroupName(e.target.value)}
                              className="text-sm bg-background"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Members
                            </label>
                            <div className="space-y-2">
                              {groupMembers.map((member, index) => (
                                <div key={index} className="flex items-center space-x-2">
                                  <Input
                                    placeholder="Email, phone, or 0x…"
                                    value={member}
                                    onChange={(e) => updateGroupMember(index, e.target.value)}
                                    className="text-sm flex-1 bg-background"
                                  />
                                  {groupMembers.length > 1 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeGroupMember(index)}
                                      className="px-2 bg-background border-border"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={addGroupMember}
                                className="w-full h-10 bg-primary text-primary-foreground hover:opacity-90 active:opacity-80 border border-border transition-all"
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Add Member
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Add members by email, phone, or wallet address
                            </p>
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setShowNewConversationDialog(false);
                                setGroupName('');
                                setGroupMembers(['']);
                                setConversationType('dm');
                              }}
                              className="border-border bg-background"
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleCreateGroup}
                              disabled={!groupName.trim() || isCreatingGroup}
                              className="bg-primary hover:opacity-90 text-primary-foreground border border-primary"
                            >
                              {isCreatingGroup ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-0 animate-spin" />
                                  Creating...
                                </>
                              ) : (
                                <>
                                  <Users className="w-4 h-4 mr-0" />
                                  Create Group
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              
              {/* Sync Button */}
              {isConnected && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleManualSync}
                  disabled={isLoading || isAutoSyncing}
                  title="Sync messages"
                  className="px-3 bg-background w-11 md:w-auto"
                >
                  <RefreshCw className={cn("w-4 h-4 md:mr-0", (isAutoSyncing || isLoading) && "animate-spin")} />
                  <span className="hidden md:inline">Sync</span>
                </Button>
              )}

              {/* Hidden Conversations Toggle */}
              {isConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHiddenConversations(!showHiddenConversations)}
                  className="px-3 bg-background"
                  title={showHiddenConversations ? "Show active conversations" : "Show hidden conversations"}
                >
                  {showHiddenConversations ? (
                    <>
                      <Eye className="w-4 h-4 mr-0" />
                      <span>Active</span>
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4 mr-0" />
                      <span>Hidden</span>
                    </>
                  )}
                </Button>
              )}
            {/* Close */}
            <Button variant="outline" size="sm" onClick={onClose} className="px-3 bg-background">
              <X className="w-4 h-4" />
            </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Mobile Conversation List View */}
          <div className="md:hidden flex-1 flex flex-col min-h-0">
            {!selectedConversation ? (
              <>
                {/* Mobile Search */}
                <div className="p-4 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9.5 h-[44px] bg-background placeholder:text-sm placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                {/* Mobile Conversation List */}
                <div className="flex-1 overflow-y-auto">
                  {!isConnected ? (
                    <div className="p-4">
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-center">
                            <MessageCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground mb-3">
                              {isConnecting 
                                ? "Connecting to XMTP..." 
                                : isConnected 
                                  ? "XMTP is connected and ready"
                                  : "Connect your wallet to start messaging"
                              }
                            </p>
                            {!isConnected && !isConnecting && (
                              <Button 
                                onClick={handleConnect} 
                                disabled={isConnecting}
                                className="w-full bg-background"
                              >
                                <MessageCircle className="w-4 h-4 mr-2" />
                                Connect XMTP
                              </Button>
                            )}
                            {isConnecting && (
                              <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Connecting...</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-muted-foreground px-2 py-2 mb-0 border-b border-border pb-2">
                        {filteredConversations.length} conversation{filteredConversations.length !== 1 ? 's' : ''}
                      </div>
                      {filteredConversations.map((conversation) => (
                        <SwipeableRow
                          key={conversation.id}
                          archiveIcon={showHiddenConversations ? <Eye className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                          archiveLabel={showHiddenConversations ? 'Unhide' : 'Archive'}
                          onArchive={() => (showHiddenConversations ? unhideConversation(conversation.id) : hideConversation(conversation.id))}
                          onDelete={() => removeConversation(conversation.id)}
                        >
                        <div
                          className={cn(
                            "p-3 transition-colors border-b border-border last:border-b-0",
                            selectedConversation === conversation.id
                              ? "bg-info/10 border-l-4 border-l-blue-500 dark:border-l-blue-400"
                              : "hover:bg-secondary"
                          )}
                        >
                                                      <div className="flex items-center justify-between">
                              <div 
                                className="flex-1 flex items-center space-x-3 cursor-pointer"
                                onClick={() => {
                                  setSelectedConversation(conversation.id);
                                  loadMessages(conversation.id);
                                }}
                              >
                                <div className="w-10 h-10 bg-info/15 rounded-full flex items-center justify-center flex-shrink-0">
                                  <User className="w-5 h-5 text-info" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">
                                    {getConversationTitle(conversation)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {isGroupConversation(conversation.id) ? 'Group Chat' : 'Direct Message'}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showHiddenConversations) {
                                    unhideConversation(conversation.id);
                                  } else {
                                    hideConversation(conversation.id);
                                  }
                                }}
                                className="px-2 py-1 h-10 bg-background"
                                title={showHiddenConversations ? "Unhide conversation" : "Hide conversation"}
                              >
                                {showHiddenConversations ? (
                                  <Eye className="w-4 h-4" />
                                ) : (
                                  <EyeOff className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                        </div>
                        </SwipeableRow>
                      ))}
                      {filteredConversations.length === 0 && (
                        <div className="p-4 bg-secondary rounded-sm">
                          <p className="text-sm text-muted-foreground text-center">
                            {showHiddenConversations 
                              ? "No hidden conversations" 
                              : "No conversations yet"
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Mobile Conversation Header */}
                <div className="p-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        {getConversationTitle(selectedConversation || '')}
                        {isGroupConversation(selectedConversation || '') && (
                          <button
                            type="button"
                            onClick={() => openRenameGroup(selectedConversation || '')}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Rename group"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {conversationSubtitle(selectedConversation || '')}
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedConversation(null)}
                        className="px-3 bg-background"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        <span>Back</span>
                      </Button>
                    </div>
                  </div>
                </div>
                
                {/* Mobile Messages */}
                <div ref={msgScrollMobileRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {currentMessages.map((message, index) => {
                    // Determine if this message is from the current user using inbox ID
                    const messageSender = message.senderInboxId;
                    
                    // Compare sender inbox ID with current user's inbox ID
                    const isFromCurrentUser = messageSender && currentUserInboxId && 
                      messageSender === currentUserInboxId;
                    
                    // Debug logging to understand message structure
                    console.log('XMTP: Message debug:', {
                      index,
                      messageId: message.id,
                      content: message.content,
                      senderInboxId: message.senderInboxId,
                      currentUserInboxId,
                      isFromCurrentUser,
                      messageKeys: Object.keys(message)
                    });
                    
                    return (
                      <div
                        key={index}
                        className={cn(
                          "flex",
                          isFromCurrentUser ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] px-4 py-3 rounded-sm",
                            isFromCurrentUser
                              ? "bg-primary text-primary-foreground" // Sent message styling
                              : "bg-secondary text-foreground" // Received message styling
                          )}
                        >
                          {/* Message content */}
                          <p className="text-sm leading-relaxed">
                            {typeof message.content === 'string' ? message.content : 'Message'}
                          </p>
                          
                          {/* Message metadata */}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs opacity-70">
                              {formatTimestamp(message.sentAtNs ? new Date(Number(message.sentAtNs) / 1000000) : new Date())}
                            </p>
                            <p className="text-xs opacity-70 ml-3">
                              {isFromCurrentUser 
                                ? "You" 
                                : formatAddress(messageSender || 'Unknown')
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Mobile Message Input */}
                <div className="p-4 border-t border-border">
                  <div className="flex space-x-2">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm leading-relaxed py-2 bg-background"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isSending}
                      className="flex-shrink-0 w-[44px] h-[44px] p-0 flex items-center justify-center bg-primary"
                    >
                      {isSending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 text-primary-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Desktop Sidebar - Conversations */}
          <div className={cn(
            "border-r border-border flex flex-col hidden md:flex transition-all duration-300",
            isConversationListCollapsed ? "w-16" : "w-80"
          )}>
            {/* Header with collapse toggle */}
            <div className={cn(
              "border-b border-border flex items-center transition-all duration-300",
              isConversationListCollapsed ? "p-0 justify-center h-[69px]" : "p-3 justify-between"
            )}>
              {!isConversationListCollapsed && (
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-foreground w-4 h-4" />
                  <Input
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9.5 h-[44px] placeholder:text-sm placeholder:text-muted-foreground"
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsConversationListCollapsed(!isConversationListCollapsed)}
                className={cn(
                  "transition-all duration-300 bg-background",
                  isConversationListCollapsed ? "mx-auto" : "ml-2"
                )}
                title={isConversationListCollapsed ? "Expand conversations" : "Collapse conversations"}
              >
                {isConversationListCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {!isConnected ? (
                <div className="p-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center">
                        <MessageCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground mb-3">
                          {isConnecting 
                            ? "Connecting to XMTP..." 
                            : isConnected 
                              ? "XMTP is connected and ready"
                              : "Connect your wallet to start messaging"
                          }
                        </p>
                        {!isConnected && !isConnecting && (
                          <Button 
                            onClick={handleConnect} 
                            disabled={isConnecting}
                            className="w-full"
                          >
                            <MessageCircle className="w-4 h-4 mr-2" />
                            Connect XMTP
                          </Button>
                        )}
                        {isConnecting && (
                          <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Connecting...</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className={cn(
                  "transition-all duration-300",
                  isConversationListCollapsed ? "" : ""
                )}>
                  {!isConversationListCollapsed && (
                    <div className="text-xs text-muted-foreground px-3 py-2 mb-0 border-b border-border pb-2">
                      {filteredConversations.length} {showHiddenConversations ? 'hidden' : ''} conversation{filteredConversations.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  {filteredConversations.map((conversation) => (
                    <SwipeableRow
                      key={conversation.id}
                      archiveIcon={showHiddenConversations ? <Eye className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      archiveLabel={showHiddenConversations ? 'Unhide' : 'Archive'}
                      onArchive={() => (showHiddenConversations ? unhideConversation(conversation.id) : hideConversation(conversation.id))}
                      onDelete={() => removeConversation(conversation.id)}
                    >
                    <div
                      className={cn(
                                                  "transition-colors group",
                          isConversationListCollapsed
                            ? "p-3 flex justify-center h-16"
                            : "p-3 h-16 content-center border-b border-border last:border-b-0",
                        selectedConversation === conversation.id
                          ? "bg-info/10 border-l-4 border-l-blue-500 dark:border-l-blue-400"
                          : "hover:bg-secondary"
                      )}
                    >
                                              <div className={cn(
                          "flex items-center justify-between",
                          isConversationListCollapsed ? "justify-center" : ""
                        )}>
                          <div 
                            className={cn(
                              "flex items-center",
                              isConversationListCollapsed ? "justify-center" : "space-x-3"
                            )}
                            onClick={() => {
                              console.log('XMTP: Selected conversation:', conversation.id);
                              setSelectedConversation(conversation.id);
                              loadMessages(conversation.id);
                            }}
                          >
                            <div className="w-8 h-8 bg-info/15 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="w-4 h-4 text-info" />
                            </div>
                            {!isConversationListCollapsed && (
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {getConversationTitle(conversation)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {conversationSubtitle(conversation.id)}
                                </p>
                              </div>
                            )}
                          </div>
                          {!isConversationListCollapsed && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (showHiddenConversations) {
                                  unhideConversation(conversation.id);
                                } else {
                                  hideConversation(conversation.id);
                                }
                              }}
                              className="px-2 py-1 h-8 opacity-0 group-hover:opacity-100 transition-opacity bg-background"
                              title={showHiddenConversations ? "Unhide conversation" : "Hide conversation"}
                            >
                              {showHiddenConversations ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                            </Button>
                          )}
                        </div>
                    </div>
                    </SwipeableRow>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Desktop Main Chat Area */}
          <div className="flex-1 flex flex-col w-full min-h-0 hidden md:flex">
            {selectedConversation ? (
              <>
                {/* Desktop Conversation Header */}
                <div className="p-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        {getConversationTitle(selectedConversation || '')}
                        {isGroupConversation(selectedConversation || '') && (
                          <button
                            type="button"
                            onClick={() => openRenameGroup(selectedConversation || '')}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Rename group"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {conversationSubtitle(selectedConversation || '')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div ref={msgScrollDesktopRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {currentMessages.map((message, index) => {
                    // Determine if this message is from the current user using inbox ID
                    const messageSender = message.senderInboxId;
                    
                    // Compare sender inbox ID with current user's inbox ID
                    const isFromCurrentUser = messageSender && currentUserInboxId && 
                      messageSender === currentUserInboxId;
                    
                    // Debug logging to understand message structure
                    console.log('XMTP: Message debug:', {
                      index,
                      messageId: message.id,
                      content: message.content,
                      senderInboxId: message.senderInboxId,
                      currentUserInboxId,
                      isFromCurrentUser,
                      messageKeys: Object.keys(message)
                    });
                    
                    return (
                      <div
                        key={index}
                        className={cn(
                          "flex",
                          isFromCurrentUser ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] sm:max-w-xs lg:max-w-md px-4 py-3 rounded-sm",
                            isFromCurrentUser
                              ? "bg-primary text-primary-foreground" // Sent message styling
                              : "bg-secondary text-foreground" // Received message styling
                          )}
                        >
                          {/* Message content */}
                          <p className="text-sm leading-relaxed">
                            {typeof message.content === 'string' ? message.content : 'Message'}
                          </p>
                          
                          {/* Message metadata */}
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-xs opacity-70">
                              {formatTimestamp(message.sentAtNs ? new Date(Number(message.sentAtNs) / 1000000) : new Date())}
                            </p>
                            <p className="text-xs opacity-70 ml-3">
                              {isFromCurrentUser 
                                ? "You" 
                                : formatAddress(messageSender || 'Unknown')
                              }
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Message Input */}
                <div className="p-4 border-t border-border">
                  <div className="flex space-x-2">
                    <Textarea
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message..."
                      className="flex-1 min-h-[44px] max-h-[120px] resize-none text-sm leading-relaxed py-2 bg-background"
                      rows={1}
                    />
                    <Button 
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || isSending}
                      className="flex-shrink-0 w-[44px] h-[44px] p-0 flex items-center justify-center bg-primary"
                    >
                      {isSending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 text-primary-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-8">
                  <MessageCircle className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-display text-xl font-medium text-foreground mb-2">
                    {isConnected 
                      ? (ownerAddress ? "Creating conversation..." : "Select a conversation") 
                      : "Connect to start messaging"
                    }
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    {isConnected 
                      ? (ownerAddress 
                          ? `Setting up conversation with ${formatAddress(ownerAddress)}...`
                          : "Choose a conversation from the list above to start messaging"
                        )
                      : "Connect your wallet to start messaging with T-Deed owners"
                    }
                  </p>
                  {!isConnected && !isConnecting && (
                    <Button onClick={handleConnect} className="w-full max-w-xs bg-background">
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Connect XMTP
                    </Button>
                  )}
                  {isConnected && ownerAddress && (
                    <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Setting up conversation...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Rename group — any member can set a custom name that everyone sees */}
      <Dialog open={!!renameGroupId} onOpenChange={(open) => { if (!open) setRenameGroupId(null); }}>
        <DialogContent overlayClassName="z-[110]" className="z-[120] w-[calc(100vw-2rem)] max-w-sm mx-auto rounded-sm border-border">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              autoFocus
              placeholder="Group name"
              value={renameGroupValue}
              onChange={(e) => setRenameGroupValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRenameGroup(); }}
              className="text-sm bg-background"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameGroupId(null)} className="border-border bg-background">
                Cancel
              </Button>
              <Button
                onClick={submitRenameGroup}
                disabled={!renameGroupValue.trim() || isRenamingGroup}
                className="bg-primary hover:opacity-90 text-primary-foreground border border-primary"
              >
                {isRenamingGroup ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default XMTPMessaging; 