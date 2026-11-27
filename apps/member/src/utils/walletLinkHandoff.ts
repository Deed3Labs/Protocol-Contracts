export const PENDING_WALLET_LINK_HANDOFF_KEY = 'pendingWalletLinkHandoff';

export interface PendingWalletLinkHandoff {
  token: string;
  label: string;
  description: string;
  createdAt: string;
  expiresAt: string;
}

export function savePendingWalletLinkHandoff(handoff: PendingWalletLinkHandoff): void {
  sessionStorage.setItem(PENDING_WALLET_LINK_HANDOFF_KEY, JSON.stringify(handoff));
}

export function loadPendingWalletLinkHandoff(): PendingWalletLinkHandoff | null {
  const raw = sessionStorage.getItem(PENDING_WALLET_LINK_HANDOFF_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingWalletLinkHandoff;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingWalletLinkHandoff(): void {
  sessionStorage.removeItem(PENDING_WALLET_LINK_HANDOFF_KEY);
}
