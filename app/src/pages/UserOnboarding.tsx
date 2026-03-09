import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Crown,
  Gem,
  Globe,
  IdCard,
  KeyRound,
  Landmark,
  LockKeyhole,
  ScanFace,
  Shield,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";

import ClearPathLogo from "@/assets/ClearPath-Logo.png";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAppKitAuth } from "@/hooks/useAppKitAuth";
import { cn } from "@/lib/utils";

type StepId = "access" | "discovery" | "profile" | "setup";
type AccessTrackId = "wallet" | "hybrid" | "verified";
type AccountMethod = "wallet" | "appkit-account" | "anonymous-preview";
type IdentityMode = "anonymous" | "privacy" | "verified";
type MembershipPlanId = "yearly" | "lifetime";
type RecoveryMethodId = "passkey" | "hardware" | "multisig";

interface StepDefinition {
  id: StepId;
  label: string;
  title: string;
  description: string;
  icon: typeof Wallet;
}

interface AccessTrack {
  id: AccessTrackId;
  title: string;
  description: string;
  detail: string;
  badge?: string;
  accountMethod: AccountMethod;
  identityMode: IdentityMode;
  icon: typeof Wallet;
}

interface IdentityModeOption {
  id: IdentityMode;
  title: string;
  summary: string;
  detail: string;
  icon: typeof Shield;
  unlocks: string[];
}

interface MembershipPlan {
  id: MembershipPlanId;
  title: string;
  cadence: string;
  summary: string;
  badge?: string;
  icon: typeof Crown;
  perks: string[];
}

interface RecoveryMethod {
  id: RecoveryMethodId;
  title: string;
  detail: string;
  icon: typeof KeyRound;
}

interface OnboardingFormState {
  accessTrack: AccessTrackId;
  accountMethod: AccountMethod;
  identityMode: IdentityMode;
  referralSource: string;
  inviteCode: string;
  incomeSource: string;
  reasons: string[];
  goalsNote: string;
  username: string;
  legalName: string;
  email: string;
  phone: string;
  cityRegion: string;
  country: string;
  settlementCurrency: string;
  membershipPlan: MembershipPlanId;
  recoveryMethod: RecoveryMethodId;
  notificationsOptIn: boolean;
  cardWaitlist: boolean;
  localPools: boolean;
  termsAccepted: boolean;
}

const ONBOARDING_STEPS: StepDefinition[] = [
  {
    id: "access",
    label: "Step 1",
    title: "Connect Wallet / Create Account",
    description: "Choose the entry path and how much identity the user wants to share at signup.",
    icon: Wallet,
  },
  {
    id: "discovery",
    label: "Step 2",
    title: "Registration / Marketing Info",
    description: "Capture source, income context, and product intent without leading with compliance.",
    icon: Sparkles,
  },
  {
    id: "profile",
    label: "Step 3",
    title: "Profile Information",
    description: "Collect username, contact details, residency, and a settlement currency derived from location.",
    icon: UserRound,
  },
  {
    id: "setup",
    label: "Step 4",
    title: "Account Setup",
    description: "Let users choose privacy posture, membership plan, and security preferences.",
    icon: Crown,
  },
];

const ACCESS_TRACKS: AccessTrack[] = [
  {
    id: "wallet",
    title: "Wallet first",
    description: "Connect an existing wallet and keep the first session lightweight.",
    detail: "Best for self-custody users who want to explore and finish identity checks later.",
    badge: "No KYC at signup",
    accountMethod: "wallet",
    identityMode: "anonymous",
    icon: Wallet,
  },
  {
    id: "hybrid",
    title: "Create a Clear account",
    description: "Use AppKit login with a privacy-first profile and unlock more product depth later.",
    detail: "Good default for a fintech-style onboarding path without forcing full KYC on day one.",
    badge: "Recommended",
    accountMethod: "appkit-account",
    identityMode: "privacy",
    icon: Sparkles,
  },
  {
    id: "verified",
    title: "Full membership path",
    description: "Prepare for virtual accounts, spend features, and higher limits with a verified profile.",
    detail: "For users who already know they want card, fiat, and local investment features.",
    badge: "Expanded access",
    accountMethod: "wallet",
    identityMode: "verified",
    icon: BadgeCheck,
  },
];

const REFERRAL_SOURCES = [
  "Friend or invite code",
  "X / Twitter",
  "Telegram or Discord",
  "Wallet app discovery",
  "Local business partner",
  "Search or article",
  "Community event",
];

const INCOME_SOURCES = [
  "Salary / wages",
  "Self-employed business",
  "Freelance / creator income",
  "Investments / dividends",
  "Crypto trading / staking",
  "Community treasury / DAO",
];

const REASON_OPTIONS = [
  "Saving for first home",
  "Tracking your Spending",
  "Non-Custodial Virtual Accounts",
  "Equity Credit (spend) Card",
  "Local Business & Community Investments",
];

const COUNTRY_OPTIONS = [
  "United States",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "United Arab Emirates",
  "Singapore",
  "Nigeria",
  "Mexico",
  "Brazil",
];

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  "United States": "USD",
  Canada: "CAD",
  "United Kingdom": "GBP",
  Germany: "EUR",
  France: "EUR",
  "United Arab Emirates": "AED",
  Singapore: "SGD",
  Nigeria: "NGN",
  Mexico: "MXN",
  Brazil: "BRL",
};

const IDENTITY_MODES: IdentityModeOption[] = [
  {
    id: "anonymous",
    title: "Anonymous / wallet-only",
    summary: "Ask for only the basics now.",
    detail: "Username and residency are enough to keep exploring without finishing KYC.",
    icon: Shield,
    unlocks: [
      "Wallet-first profile",
      "View and save product preferences",
      "Complete verification later",
    ],
  },
  {
    id: "privacy",
    title: "Privacy-first",
    summary: "Collect contact details now and defer deeper checks.",
    detail: "A middle path for members who want personalization without a full KYC wall at signup.",
    icon: LockKeyhole,
    unlocks: [
      "Invite + referral tracking",
      "Virtual account and card waitlist routing",
      "Selective disclosure later",
    ],
  },
  {
    id: "verified",
    title: "Verified member",
    summary: "Prepare the account for higher limits and fiat-linked features.",
    detail: "Best when the user expects a spend card, local investing access, or higher transaction limits.",
    icon: IdCard,
    unlocks: [
      "Priority activation when KYC launches",
      "Higher future limits",
      "Expanded account access",
    ],
  },
];

const MEMBERSHIP_PLANS: MembershipPlan[] = [
  {
    id: "yearly",
    title: "Yearly membership",
    cadence: "Recurring annual plan",
    summary: "Best for users who want flexibility while Clear continues expanding into new regions and products.",
    badge: "Flexible",
    icon: CalendarDays,
    perks: [
      "Annual membership registry renewal",
      "Access to virtual accounts and card waitlists",
      "Member pricing on future launches",
      "Quarterly community updates",
    ],
  },
  {
    id: "lifetime",
    title: "Lifetime membership",
    cadence: "One-time access",
    summary: "A founder-style plan for users who want permanent access and priority on new product rails.",
    badge: "Founding tier",
    icon: Gem,
    perks: [
      "Permanent membership registry access",
      "Priority for new city rollouts and local pools",
      "Higher-touch concierge onboarding when live",
      "Founder badge and long-term fee preference",
    ],
  },
];

const RECOVERY_METHODS: RecoveryMethod[] = [
  {
    id: "passkey",
    title: "Passkey preferred",
    detail: "Smoothest mobile-first recovery flow when supported.",
    icon: ScanFace,
  },
  {
    id: "hardware",
    title: "Hardware wallet",
    detail: "Best for stronger signing security and treasury-sized balances.",
    icon: Wallet,
  },
  {
    id: "multisig",
    title: "Multisig / team access",
    detail: "Useful for family accounts, local businesses, or shared approvals.",
    icon: KeyRound,
  },
];

const NETWORK_LABELS: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  8453: "Base",
  84532: "Base Sepolia",
  42161: "Arbitrum",
  11155111: "Sepolia",
};

const panelMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};

const panelTransition = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1] as const,
};

function truncateAddress(address?: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getStepStatus(stepIndex: number, currentIndex: number) {
  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
        {label}
      </span>
      <span className="text-right text-sm text-black dark:text-white">{value}</span>
    </div>
  );
}

function FlatOption({
  active,
  title,
  description,
  detail,
  badge,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  detail: string;
  badge?: string;
  icon: typeof Wallet;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition-colors",
        active
          ? "border-black dark:border-white bg-zinc-50 dark:bg-zinc-900"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-black dark:text-white">{title}</p>
              {badge ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">{detail}</p>
          </div>
        </div>
        <div
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
            active
              ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
              : "border-zinc-300 text-transparent dark:border-zinc-700"
          )}
        >
          <Check className="size-3" />
        </div>
      </div>
    </button>
  );
}

export default function UserOnboarding() {
  const { address, chainId, isConnected, openModal } = useAppKitAuth();
  const navigate = useNavigate();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [form, setForm] = useState<OnboardingFormState>({
    accessTrack: "hybrid",
    accountMethod: "appkit-account",
    identityMode: "privacy",
    referralSource: "",
    inviteCode: "",
    incomeSource: "",
    reasons: ["Tracking your Spending"],
    goalsNote: "",
    username: "",
    legalName: "",
    email: "",
    phone: "",
    cityRegion: "",
    country: "United States",
    settlementCurrency: "USD",
    membershipPlan: "yearly",
    recoveryMethod: "passkey",
    notificationsOptIn: true,
    cardWaitlist: true,
    localPools: true,
    termsAccepted: false,
  });

  const currentStep = ONBOARDING_STEPS[currentStepIndex];
  const selectedTrack = ACCESS_TRACKS.find((track) => track.id === form.accessTrack) ?? ACCESS_TRACKS[1];
  const selectedIdentity =
    IDENTITY_MODES.find((mode) => mode.id === form.identityMode) ?? IDENTITY_MODES[1];
  const selectedMembership =
    MEMBERSHIP_PLANS.find((plan) => plan.id === form.membershipPlan) ?? MEMBERSHIP_PLANS[0];
  const chainLabel = chainId ? NETWORK_LABELS[chainId] ?? `Chain ${chainId}` : "AppKit network pending";

  useEffect(() => {
    const nextCurrency = CURRENCY_BY_COUNTRY[form.country] ?? "USD";
    if (form.settlementCurrency !== nextCurrency) {
      setForm((prev) => ({ ...prev, settlementCurrency: nextCurrency }));
    }
  }, [form.country, form.settlementCurrency]);

  const stepValidity = useMemo(() => {
    const hasContact = form.identityMode === "anonymous" || form.email.trim().length > 0;
    const hasLegalName = form.identityMode !== "verified" || form.legalName.trim().length > 0;

    return {
      access: form.accessTrack.length > 0,
      discovery:
        form.referralSource.trim().length > 0 &&
        form.incomeSource.trim().length > 0 &&
        form.reasons.length > 0,
      profile:
        form.username.trim().length > 0 &&
        form.cityRegion.trim().length > 0 &&
        form.country.trim().length > 0 &&
        hasContact &&
        hasLegalName,
      setup:
        form.membershipPlan.length > 0 &&
        form.recoveryMethod.length > 0 &&
        form.termsAccepted &&
        hasContact &&
        hasLegalName,
    };
  }, [form]);

  const canContinue = stepValidity[currentStep.id];

  const helperCopy = useMemo(() => {
    if (canContinue) return "Ready to continue.";
    if (currentStep.id === "access") return "Choose the path this user should start with.";
    if (currentStep.id === "discovery") {
      return "Select a referral source, a primary income source, and at least one reason for joining.";
    }
    if (currentStep.id === "profile") {
      return form.identityMode === "anonymous"
        ? "Wallet-only onboarding requires username, city or region, and country."
        : "Complete username, email, city or region, and country to continue.";
    }
    return "Choose membership, recovery method, and accept the membership terms.";
  }, [canContinue, currentStep.id, form.identityMode]);

  const updateField = <K extends keyof OnboardingFormState>(key: K, value: OnboardingFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleReason = (reason: string) => {
    setForm((prev) => ({
      ...prev,
      reasons: prev.reasons.includes(reason)
        ? prev.reasons.filter((item) => item !== reason)
        : [...prev.reasons, reason],
    }));
  };

  const handleAccessTrackSelect = (track: AccessTrack) => {
    setForm((prev) => ({
      ...prev,
      accessTrack: track.id,
      accountMethod: track.accountMethod,
      identityMode: track.identityMode,
    }));
  };

  const handleConnect = async () => {
    try {
      await openModal("Connect");
    } catch (error) {
      console.error("Failed to open AppKit modal:", error);
    }
  };

  const handleBack = () => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    if (!canContinue) return;
    if (currentStepIndex === ONBOARDING_STEPS.length - 1) {
      setIsComplete(true);
      return;
    }
    setCurrentStepIndex((prev) => Math.min(prev + 1, ONBOARDING_STEPS.length - 1));
  };

  if (isComplete) {
    return (
      <div className="min-h-screen bg-white text-black transition-colors duration-200 dark:bg-[#0e0e0e] dark:text-white">
        <main className="container mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-14">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded border border-black/90 bg-white dark:border-white/10 dark:bg-[#0e0e0e]">
                <img src={ClearPathLogo} alt="ClearPath" className="h-full w-full object-cover" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">Clear</p>
                <p className="text-sm text-black dark:text-white">Onboarding</p>
              </div>
            </div>
            <Button
              type="button"
              className="rounded bg-black px-4 py-2 text-sm font-normal text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              onClick={() => navigate("/login")}
            >
              Return to login
            </Button>
          </div>

          <div className="mt-10">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">User onboarding</p>
              <h1 className="mt-2 text-[42px] font-light tracking-tight text-black dark:text-white sm:text-[52px]">
                The flow is in place and ready to wire into AppKit, registry writes, and real account rules.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                This is still a UI-only surface, but the structure now supports wallet-first onboarding, privacy-first signup, and a verified member path without changing the layout later.
              </p>
            </div>

            <div className="mt-10 overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800">
              <div className="grid gap-0 md:grid-cols-2">
                <div className="px-6 py-6 sm:px-8">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                    Selected path
                  </p>
                  <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                    <SummaryRow label="Access" value={selectedTrack.title} />
                    <SummaryRow label="Identity" value={selectedIdentity.title} />
                    <SummaryRow label="Membership" value={selectedMembership.title} />
                    <SummaryRow
                      label="Residency"
                      value={`${form.country} • ${form.settlementCurrency}`}
                    />
                  </div>
                </div>

                <div className="border-t border-zinc-200 px-6 py-6 dark:border-zinc-800 md:border-t-0 md:border-l sm:px-8">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                    Next functional wiring
                  </p>
                  <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                    {[
                      "Persist onboarding answers to the membership registry",
                      "Branch real feature access by identity posture and membership plan",
                      "Use AppKit connection state to auto-advance wallet setup",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-3 py-3">
                        <div className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
                          <Check className="size-3 text-black dark:text-white" />
                        </div>
                        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
                onClick={() => {
                  setIsComplete(false);
                  setCurrentStepIndex(0);
                }}
              >
                Review onboarding
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black transition-colors duration-200 dark:bg-[#0e0e0e] dark:text-white">
      <main className="container mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded border border-black/90 bg-white dark:border-white/10 dark:bg-[#0e0e0e]">
              <img src={ClearPathLogo} alt="ClearPath" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">Clear</p>
              <p className="text-sm text-black dark:text-white">User onboarding</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="outline"
              className="rounded border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
            >
              <Link to="/login">
                <ArrowLeft className="size-4" />
                Back
              </Link>
            </Button>
            <Button
              type="button"
              className="rounded bg-black px-4 py-2 text-sm font-normal text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              onClick={handleConnect}
            >
              {isConnected ? "Connected" : "Connect"}
            </Button>
          </div>
        </div>

        <div className="mt-10">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">User onboarding</p>
            <h1 className="mt-2 text-[42px] font-light tracking-tight text-black dark:text-white sm:text-[52px]">
              A clearer signup flow for wallet-first, privacy-first, and fully verified members.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              This version keeps the portfolio page typography and border treatment, but removes shell chrome so the onboarding itself can stay focused, standalone, and easier to complete on mobile.
            </p>
          </div>

          <div className="mt-8 overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800">
            <div className="grid gap-0 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Access", value: selectedTrack.title },
                { label: "Wallet", value: isConnected ? truncateAddress(address) : "Connect later" },
                { label: "Identity", value: selectedIdentity.title },
                { label: "Membership", value: selectedMembership.title },
              ].map((item, index) => (
                <div
                  key={item.label}
                  className={cn(
                    "px-5 py-4",
                    index > 0 && "border-t border-zinc-200 dark:border-zinc-800 sm:border-t-0",
                    index % 2 === 1 && "sm:border-l sm:border-zinc-200 dark:sm:border-zinc-800",
                    index > 1 && "xl:border-l xl:border-zinc-200 dark:xl:border-zinc-800"
                  )}
                >
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                    {item.label}
                  </p>
                  <p className="mt-2 text-sm font-medium text-black dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 border-y border-zinc-200 py-4 dark:border-zinc-800">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {ONBOARDING_STEPS.map((step, index) => {
                const status = getStepStatus(index, currentStepIndex);
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setCurrentStepIndex(index)}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-colors",
                      status === "current" &&
                        "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900",
                      status === "complete" &&
                        "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/70",
                      status === "upcoming" &&
                        "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex size-9 items-center justify-center rounded border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                        <step.icon className="size-4" />
                      </div>
                      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                        {step.label}
                      </span>
                    </div>
                    <p className="mt-4 text-sm font-medium text-black dark:text-white">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {step.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <section className="mt-8 overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800">
              <div className="border-b border-zinc-200 px-6 py-6 dark:border-zinc-800 sm:px-8">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                      {currentStep.label}
                    </p>
                    <h2 className="mt-2 text-2xl font-light tracking-tight text-black dark:text-white sm:text-[32px]">
                      {currentStep.title}
                    </h2>
                  </div>
                  <p className="max-w-xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {currentStep.description}
                  </p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep.id}
                  {...panelMotion}
                  transition={panelTransition}
                  className="px-6 py-6 sm:px-8"
                >
                  {currentStep.id === "access" ? (
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="space-y-4">
                        {ACCESS_TRACKS.map((track) => (
                          <FlatOption
                            key={track.id}
                            active={form.accessTrack === track.id}
                            title={track.title}
                            description={track.description}
                            detail={track.detail}
                            badge={track.badge}
                            icon={track.icon}
                            onClick={() => handleAccessTrackSelect(track)}
                          />
                        ))}
                      </div>

                      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                          Connection status
                        </p>
                        <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                          <SummaryRow
                            label="Wallet"
                            value={isConnected ? truncateAddress(address) : "Connect later"}
                          />
                          <SummaryRow label="Network" value={chainLabel} />
                          <SummaryRow label="Mode" value={selectedTrack.title} />
                        </div>

                        <div className="mt-6 space-y-3">
                          {[
                            "Use AppKit for wallet or embedded account entry",
                            "Reserve a membership record later via smart contract",
                            "Branch KYC and entitlements by selected path",
                          ].map((item) => (
                            <div key={item} className="flex items-start gap-3 py-2">
                              <div className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
                                <ChevronRight className="size-3 text-black dark:text-white" />
                              </div>
                              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-6">
                          <Button
                            type="button"
                            className="w-full rounded bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                            onClick={handleConnect}
                          >
                            Connect with AppKit
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {currentStep.id === "discovery" ? (
                    <div className="space-y-8">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="referral-source">How did you find us?</Label>
                          <Select
                            value={form.referralSource}
                            onValueChange={(value) => updateField("referralSource", value)}
                          >
                            <SelectTrigger
                              id="referral-source"
                              className="h-11 w-full border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                            >
                              <SelectValue placeholder="Select a source" />
                            </SelectTrigger>
                            <SelectContent className="border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                              {REFERRAL_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>
                                  {source}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="invite-code">Invite code</Label>
                          <Input
                            id="invite-code"
                            placeholder="Optional referral or ambassador code"
                            className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                            value={form.inviteCode}
                            onChange={(event) => updateField("inviteCode", event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <div className="space-y-2">
                          <Label htmlFor="income-source">Primary source of income</Label>
                          <Select
                            value={form.incomeSource}
                            onValueChange={(value) => updateField("incomeSource", value)}
                          >
                            <SelectTrigger
                              id="income-source"
                              className="h-11 w-full border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                            >
                              <SelectValue placeholder="Select a primary source of income" />
                            </SelectTrigger>
                            <SelectContent className="border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                              {INCOME_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>
                                  {source}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-black dark:text-white">
                              Reasons for joining Clear
                            </p>
                            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                              Use product intent to decide what the first dashboard emphasizes.
                            </p>
                          </div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                            Multi-select
                          </p>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {REASON_OPTIONS.map((reason) => {
                            const active = form.reasons.includes(reason);
                            return (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => toggleReason(reason)}
                                className={cn(
                                  "rounded-2xl border px-4 py-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium text-black dark:text-white">{reason}</p>
                                  <div
                                    className={cn(
                                      "flex size-5 items-center justify-center rounded-full border",
                                      active
                                        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                                        : "border-zinc-300 text-transparent dark:border-zinc-700"
                                    )}
                                  >
                                    <Check className="size-3" />
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <div className="space-y-2">
                          <Label htmlFor="goals-note">Anything we should prioritize for this member?</Label>
                          <Textarea
                            id="goals-note"
                            placeholder="Optional: note whether budgeting, home savings, virtual accounts, spend card access, or community investments matter most."
                            className="min-h-28 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                            value={form.goalsNote}
                            onChange={(event) => updateField("goalsNote", event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {currentStep.id === "profile" ? (
                    <div className="space-y-8">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="username">Username</Label>
                          <Input
                            id="username"
                            placeholder="@clear.member"
                            className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                            value={form.username}
                            onChange={(event) => updateField("username", event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="legal-name">
                            Legal name{form.identityMode === "verified" ? "" : " (optional for now)"}
                          </Label>
                          <Input
                            id="legal-name"
                            placeholder="Full legal name"
                            className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                            value={form.legalName}
                            onChange={(event) => updateField("legalName", event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="email">
                              Email{form.identityMode === "anonymous" ? " (optional for wallet-only)" : ""}
                            </Label>
                            <Input
                              id="email"
                              type="email"
                              placeholder="name@clear.money"
                              className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                              value={form.email}
                              onChange={(event) => updateField("email", event.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="phone">Phone number</Label>
                            <Input
                              id="phone"
                              type="tel"
                              placeholder="+1 (555) 123-4567"
                              className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                              value={form.phone}
                              onChange={(event) => updateField("phone", event.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="city-region">City / region</Label>
                            <Input
                              id="city-region"
                              placeholder="Los Angeles, California"
                              className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                              value={form.cityRegion}
                              onChange={(event) => updateField("cityRegion", event.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="country">Country of residency</Label>
                            <Select
                              value={form.country}
                              onValueChange={(value) => updateField("country", value)}
                            >
                              <SelectTrigger
                                id="country"
                                className="h-11 w-full border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                              >
                                <SelectValue placeholder="Select a country" />
                              </SelectTrigger>
                              <SelectContent className="border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                                {COUNTRY_OPTIONS.map((country) => (
                                  <SelectItem key={country} value={country}>
                                    {country}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                          <div>
                            <p className="text-sm font-medium text-black dark:text-white">Settlement currency</p>
                            <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                              Auto-filled from residency so local account and payout rails can be configured later.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="currency">Settlement currency</Label>
                            <Input
                              id="currency"
                              readOnly
                              className="h-11 border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white"
                              value={form.settlementCurrency}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {currentStep.id === "setup" ? (
                    <div className="space-y-8">
                      <div>
                        <p className="text-sm font-medium text-black dark:text-white">Identity posture</p>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          Make the anonymous, privacy-first, and verified paths explicit so users know what they are opting into.
                        </p>
                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          {IDENTITY_MODES.map((mode) => {
                            const Icon = mode.icon;
                            const active = form.identityMode === mode.id;
                            return (
                              <button
                                key={mode.id}
                                type="button"
                                onClick={() => updateField("identityMode", mode.id)}
                                className={cn(
                                  "rounded-2xl border p-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex size-10 items-center justify-center rounded border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                                    <Icon className="size-4" />
                                  </div>
                                  {active ? (
                                    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                                      Selected
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-4 text-sm font-medium text-black dark:text-white">{mode.title}</p>
                                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{mode.summary}</p>
                                <div className="mt-4 space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                                  {mode.unlocks.map((item) => (
                                    <div key={item} className="flex items-start gap-3">
                                      <div className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
                                        <Check className="size-3 text-black dark:text-white" />
                                      </div>
                                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{item}</p>
                                    </div>
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <p className="text-sm font-medium text-black dark:text-white">Membership</p>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          Offer yearly and lifetime side by side, with a clean breakdown of what changes between them.
                        </p>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          {MEMBERSHIP_PLANS.map((plan) => {
                            const Icon = plan.icon;
                            const active = form.membershipPlan === plan.id;
                            return (
                              <button
                                key={plan.id}
                                type="button"
                                onClick={() => updateField("membershipPlan", plan.id)}
                                className={cn(
                                  "rounded-2xl border p-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3">
                                    <div className="flex size-10 items-center justify-center rounded border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                                      <Icon className="size-4" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium text-black dark:text-white">{plan.title}</p>
                                        {plan.badge ? (
                                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                                            {plan.badge}
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{plan.cadence}</p>
                                    </div>
                                  </div>
                                  <div
                                    className={cn(
                                      "mt-0.5 flex size-5 items-center justify-center rounded-full border",
                                      active
                                        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                                        : "border-zinc-300 text-transparent dark:border-zinc-700"
                                    )}
                                  >
                                    <Check className="size-3" />
                                  </div>
                                </div>

                                <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                                  {plan.summary}
                                </p>

                                <div className="mt-4 space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                                  {plan.perks.map((perk) => (
                                    <div key={perk} className="flex items-start gap-3">
                                      <div className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
                                        <ChevronRight className="size-3 text-black dark:text-white" />
                                      </div>
                                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{perk}</p>
                                    </div>
                                  ))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
                        <p className="text-sm font-medium text-black dark:text-white">Recovery and activation preferences</p>
                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          {RECOVERY_METHODS.map((method) => {
                            const Icon = method.icon;
                            const active = form.recoveryMethod === method.id;
                            return (
                              <button
                                key={method.id}
                                type="button"
                                onClick={() => updateField("recoveryMethod", method.id)}
                                className={cn(
                                  "rounded-2xl border p-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex size-10 items-center justify-center rounded border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                                  <Icon className="size-4" />
                                </div>
                                <p className="mt-4 text-sm font-medium text-black dark:text-white">{method.title}</p>
                                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{method.detail}</p>
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                          {[
                            {
                              id: "notifications",
                              checked: form.notificationsOptIn,
                              label: "Send member updates and early-access invitations",
                              detail: "Useful for launch windows, community drops, and waitlist invites.",
                              onChange: (checked: boolean) => updateField("notificationsOptIn", checked),
                            },
                            {
                              id: "card-waitlist",
                              checked: form.cardWaitlist,
                              label: "Join the Equity Credit (spend) Card waitlist",
                              detail: "Keep this on if the user cares about future card access.",
                              onChange: (checked: boolean) => updateField("cardWaitlist", checked),
                            },
                            {
                              id: "local-pools",
                              checked: form.localPools,
                              label: "Prioritize local business and community investments",
                              detail: "Useful for city-based opportunities and community rails.",
                              onChange: (checked: boolean) => updateField("localPools", checked),
                            },
                          ].map((item) => (
                            <label
                              key={item.id}
                              htmlFor={item.id}
                              className="flex cursor-pointer items-start gap-4 py-4"
                            >
                              <Checkbox
                                id={item.id}
                                checked={item.checked}
                                onCheckedChange={(checked) => item.onChange(checked === true)}
                                className="mt-1 border-zinc-300 data-[state=checked]:border-black data-[state=checked]:bg-black data-[state=checked]:text-white dark:border-zinc-700 dark:data-[state=checked]:border-white dark:data-[state=checked]:bg-white dark:data-[state=checked]:text-black"
                              />
                              <div>
                                <p className="text-sm font-medium text-black dark:text-white">{item.label}</p>
                                <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                              </div>
                            </label>
                          ))}
                        </div>

                        <label
                          htmlFor="terms-accepted"
                          className="mt-6 flex cursor-pointer items-start gap-4 rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800"
                        >
                          <Checkbox
                            id="terms-accepted"
                            checked={form.termsAccepted}
                            onCheckedChange={(checked) => updateField("termsAccepted", checked === true)}
                            className="mt-1 border-zinc-300 data-[state=checked]:border-black data-[state=checked]:bg-black data-[state=checked]:text-white dark:border-zinc-700 dark:data-[state=checked]:border-white dark:data-[state=checked]:bg-white dark:data-[state=checked]:text-black"
                          />
                          <div>
                            <p className="text-sm font-medium text-black dark:text-white">
                              Accept membership terms and future registry activation
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                              Placeholder UI copy for the membership agreement, disclosures, and future smart-contract authorization.
                            </p>
                          </div>
                        </label>
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              </AnimatePresence>

              <div className="border-t border-zinc-200 px-6 py-5 dark:border-zinc-800 sm:px-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {helperCopy}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
                      onClick={handleBack}
                      disabled={currentStepIndex === 0}
                    >
                      <ArrowLeft className="size-4" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      className="rounded bg-black text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
                      onClick={handleNext}
                      disabled={!canContinue}
                    >
                      {currentStepIndex === ONBOARDING_STEPS.length - 1 ? "Finish flow" : "Continue"}
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-zinc-200 px-6 py-5 dark:border-zinc-800">
              <p className="text-sm font-medium text-black dark:text-white">Live summary</p>
              <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                <SummaryRow label="Location" value={form.cityRegion.trim() ? `${form.cityRegion}, ${form.country}` : form.country} />
                <SummaryRow label="Currency" value={form.settlementCurrency} />
                <SummaryRow label="Reasons" value={form.reasons.length > 0 ? `${form.reasons.length} selected` : "None selected"} />
                <SummaryRow label="Recovery" value={RECOVERY_METHODS.find((item) => item.id === form.recoveryMethod)?.title ?? "Not selected"} />
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 px-6 py-5 dark:border-zinc-800">
              <p className="text-sm font-medium text-black dark:text-white">Implementation notes</p>
              <div className="mt-4 space-y-3">
                {[
                  {
                    icon: Globe,
                    text: "Keep the layout touch-friendly on mobile with single-column sections and large tap targets.",
                  },
                  {
                    icon: Landmark,
                    text: "Auto-fill settlement currency from residency, but keep the value read-only until functional rules exist.",
                  },
                  {
                    icon: CircleDollarSign,
                    text: "Use this structure later to branch anonymous, privacy-first, and verified access without redesigning the page.",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.text} className="flex items-start gap-3">
                      <div className="flex size-9 items-center justify-center rounded border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                        <Icon className="size-4" />
                      </div>
                      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
