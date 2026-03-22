import { ethers } from 'ethers';
import type { MemberMembershipPlan, MemberRecord } from './memberStore.js';

const MEMBERSHIP_REGISTRY_ABI = [
  'function walletToMemberId(address wallet) view returns (uint256)',
  'function getMember(uint256 memberId) view returns (tuple(uint256 memberId, address primaryWallet, uint8 status, uint8 tier, uint64 joinedAt, uint64 expiresAt, bytes32 metadataHash, uint64 updatedAt))',
  'function registerMember(address primaryWallet, uint8 tier, uint64 expiresAt, bytes32 metadataHash) returns (uint256)',
  'function setMemberStatus(uint256 memberId, uint8 status)',
  'function renewMembership(uint256 memberId, uint64 newExpiresAt)',
  'function setMemberTier(uint256 memberId, uint8 tier, uint64 expiresAt)',
  'function updateMemberMetadataHash(uint256 memberId, bytes32 metadataHash)',
] as const;

type RegistryMemberRecord = {
  memberId: bigint;
  primaryWallet: string;
  status: number;
  tier: number;
  joinedAt: bigint;
  expiresAt: bigint;
  metadataHash: string;
  updatedAt: bigint;
};

interface MembershipActivationResult {
  registryMemberId: number;
  txHash: string;
  metadataHash: string;
  chainId: number;
}

const ACTIVE_STATUS = 2;
const REVOKED_STATUS = 4;
const YEARLY_TIER = 2;
const LIFETIME_TIER = 3;

function normalizePrivateKey(rawValue: string | undefined): string | null {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return null;
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return null;
}

function membershipRpcUrl(): string {
  return (
    process.env.MEMBERSHIP_RPC_URL?.trim()
    || process.env.HOME_TESTNET_RPC_URL?.trim()
    || process.env.HOME_CHAIN_RPC_URL?.trim()
    || process.env.BASE_SEPOLIA_RPC_URL?.trim()
    || process.env.VITE_ALCHEMY_BASE_SEPOLIA?.trim()
    || 'http://127.0.0.1:9545'
  );
}

function membershipChainId(): number {
  const parsed = Number.parseInt(
    process.env.MEMBERSHIP_CHAIN_ID || process.env.HOME_TESTNET_CHAIN_ID || process.env.HOME_CHAIN_ID || process.env.CLRUSD_HOME_CHAIN_ID || '92373',
    10
  );
  return Number.isFinite(parsed) ? parsed : 92373;
}

function membershipRegistryAddress(): string {
  return (process.env.MEMBERSHIP_REGISTRY_ADDRESS || '').trim();
}

function membershipRegistrarKey(): string | null {
  return normalizePrivateKey(
    process.env.MEMBERSHIP_REGISTRAR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
  );
}

function tierForPlan(plan: MemberMembershipPlan): number {
  return plan === 'LIFETIME' ? LIFETIME_TIER : YEARLY_TIER;
}

function expiryForPlan(plan: MemberMembershipPlan, currentPeriodEnd?: Date | null): bigint {
  if (plan === 'LIFETIME') {
    return 0n;
  }

  if (currentPeriodEnd instanceof Date && !Number.isNaN(currentPeriodEnd.valueOf())) {
    return BigInt(Math.floor(currentPeriodEnd.getTime() / 1000));
  }

  const nextYear = new Date();
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  return BigInt(Math.floor(nextYear.getTime() / 1000));
}

function metadataHashForMember(member: MemberRecord, plan: MemberMembershipPlan): string {
  return ethers.id(
    JSON.stringify({
      memberId: member.id,
      wallet: member.primaryWallet.toLowerCase(),
      plan: plan || 'UNSET',
      membershipStatus: member.membershipStatus,
      syncedAt: new Date().toISOString(),
    })
  );
}

export class MembershipRegistryService {
  isConfigured(): boolean {
    return Boolean(membershipRegistryAddress() && membershipRegistrarKey());
  }

  async activateMembership(
    member: MemberRecord,
    plan: MemberMembershipPlan,
    options: { currentPeriodEnd?: Date | null } = {}
  ): Promise<MembershipActivationResult> {
    const contract = this.getContract();
    const normalizedPlan = plan || member.membershipPlan;
    if (!normalizedPlan) {
      throw new Error('Membership plan is required to activate membership');
    }

    const metadataHash = metadataHashForMember(member, normalizedPlan);
    const tier = tierForPlan(normalizedPlan);
    const expiresAt = expiryForPlan(normalizedPlan, options.currentPeriodEnd);

    let registryMemberId = member.membershipRegistryMemberId ?? 0;
    let txHash = '';

    if (!registryMemberId) {
      const tx = await contract.registerMember(
        member.primaryWallet,
        tier,
        expiresAt,
        metadataHash
      );
      const receipt = await tx.wait();
      txHash = receipt?.hash || tx.hash;
      const resolvedMemberId = await contract.walletToMemberId(member.primaryWallet);
      registryMemberId = Number(resolvedMemberId);
    } else {
      const currentRecord = await contract.getMember(registryMemberId) as RegistryMemberRecord;
      if (currentRecord.tier !== tier || BigInt(currentRecord.expiresAt) !== expiresAt) {
        const tierTx = await contract.setMemberTier(registryMemberId, tier, expiresAt);
        const receipt = await tierTx.wait();
        txHash = receipt?.hash || tierTx.hash;
      } else if (normalizedPlan === 'YEARLY' && BigInt(currentRecord.expiresAt) < expiresAt) {
        const renewTx = await contract.renewMembership(registryMemberId, expiresAt);
        const receipt = await renewTx.wait();
        txHash = receipt?.hash || renewTx.hash;
      }

      if (currentRecord.metadataHash.toLowerCase() !== metadataHash.toLowerCase()) {
        const metadataTx = await contract.updateMemberMetadataHash(registryMemberId, metadataHash);
        const receipt = await metadataTx.wait();
        txHash = receipt?.hash || metadataTx.hash;
      }

      if (currentRecord.status !== ACTIVE_STATUS) {
        const statusTx = await contract.setMemberStatus(registryMemberId, ACTIVE_STATUS);
        const receipt = await statusTx.wait();
        txHash = receipt?.hash || statusTx.hash;
      }
    }

    return {
      registryMemberId,
      txHash,
      metadataHash,
      chainId: membershipChainId(),
    };
  }

  async revokeMembership(member: MemberRecord): Promise<{ txHash: string; chainId: number }> {
    if (!member.membershipRegistryMemberId) {
      throw new Error('Member has no registry membership to revoke');
    }

    const contract = this.getContract();
    const tx = await contract.setMemberStatus(member.membershipRegistryMemberId, REVOKED_STATUS);
    const receipt = await tx.wait();

    return {
      txHash: receipt?.hash || tx.hash,
      chainId: membershipChainId(),
    };
  }

  private getContract() {
    const registryAddress = membershipRegistryAddress();
    const registrarKey = membershipRegistrarKey();
    if (!registryAddress || !registrarKey) {
      throw new Error(
        'Membership registry is not configured. Set MEMBERSHIP_REGISTRY_ADDRESS and MEMBERSHIP_REGISTRAR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY.'
      );
    }

    const provider = new ethers.JsonRpcProvider(membershipRpcUrl(), membershipChainId());
    const signer = new ethers.Wallet(registrarKey, provider);
    return new ethers.Contract(registryAddress, MEMBERSHIP_REGISTRY_ABI, signer);
  }
}

export const membershipRegistryService = new MembershipRegistryService();
