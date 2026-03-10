import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  acceptMemberTerms,
  bootstrapMemberAccount,
  createMemberMembershipCheckout,
  getMemberAccountCenter,
  type MemberAccountCenterResponse,
  submitMemberOnboarding,
  updateMemberOnboarding,
  updateMemberProfile,
} from "@/utils/apiClient";

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
    title: "Get Started",
    description: "Connect your wallet or create your Clear account.",
    icon: Wallet,
  },
  {
    id: "setup",
    label: "Step 2",
    title: "Membership & Privacy",
    description: "Choose your privacy level, membership, and account preferences.",
    icon: Crown,
  },
  {
    id: "profile",
    label: "Step 3",
    title: "Profile Details",
    description: "Add your details, residency, and preferred settlement currency.",
    icon: UserRound,
  },
  {
    id: "discovery",
    label: "Step 4",
    title: "Personalize Your Experience",
    description: "Tell us how you found Clear and what you'd like to use first.",
    icon: Sparkles,
  },
];

const COMPACT_STEP_TITLES: Record<StepId, string> = {
  access: "Start",
  setup: "Membership",
  profile: "Profile",
  discovery: "Personalize",
};

const ACCESS_TRACKS: AccessTrack[] = [
  {
    id: "wallet",
    title: "Wallet first",
    description: "Connect an existing wallet and keep the first session lightweight.",
    detail: "Ideal if you want to explore first and finish the rest of your setup later.",
    badge: "No KYC at signup",
    accountMethod: "wallet",
    identityMode: "anonymous",
    icon: Wallet,
  },
  {
    id: "hybrid",
    title: "Create a Clear account",
    description: "Sign in with an account-first path and add more details as you go.",
    detail: "A balanced option if you want a smoother setup without doing everything up front.",
    badge: "Recommended",
    accountMethod: "appkit-account",
    identityMode: "privacy",
    icon: Sparkles,
  },
  {
    id: "verified",
    title: "Full membership path",
    description: "Prepare for virtual accounts, spend features, and higher limits with a verified profile.",
    detail: "Best if you already know you want card access, local investing, and expanded account features.",
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
    detail: "A middle path if you want a more tailored experience without completing everything today.",
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
    detail: "Best if you expect card access, local investing, or higher transaction limits.",
    icon: IdCard,
    unlocks: [
      "Priority access to expanded features",
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
    summary: "A flexible option if you want annual access and the ability to revisit your plan over time.",
    badge: "Flexible",
    icon: CalendarDays,
    perks: [
      "Annual membership renewal",
      "Access to virtual accounts and card waitlists",
      "Member pricing on future launches",
      "Quarterly community updates",
    ],
  },
  {
    id: "lifetime",
    title: "Lifetime membership",
    cadence: "One-time access",
    summary: "A long-term option for members who want permanent access and priority on new releases.",
    badge: "Founding tier",
    icon: Gem,
    perks: [
      "Lifetime access with no annual renewal",
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
        "w-full rounded-lg border p-4 text-left transition-colors",
        active
          ? "border-sky-300 bg-[linear-gradient(180deg,rgba(240,249,255,0.96),rgba(236,253,245,0.7))] dark:border-sky-800 dark:bg-[linear-gradient(180deg,rgba(12,74,110,0.18),rgba(6,78,59,0.12))]"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-sm border bg-white text-black dark:bg-[#0e0e0e] dark:text-white",
              active
                ? "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                : "border-zinc-200 dark:border-zinc-800"
            )}
          >
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
  const { address, chainId, isConnected, isAuthenticated, openModal, checkAuthentication } = useAppKitAuth();
  const navigate = useNavigate();
  const formSectionRef = useRef<HTMLElement | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [completedAccount, setCompletedAccount] = useState<MemberAccountCenterResponse | null>(null);
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
  const chainLabel = chainId ? NETWORK_LABELS[chainId] ?? `Chain ${chainId}` : "Choose a network after connecting";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    document.documentElement.classList.add("onboarding-scroll-enabled");
    document.body.classList.add("onboarding-scroll-enabled");

    return () => {
      document.documentElement.classList.remove("onboarding-scroll-enabled");
      document.body.classList.remove("onboarding-scroll-enabled");
    };
  }, []);

  useEffect(() => {
    const nextCurrency = CURRENCY_BY_COUNTRY[form.country] ?? "USD";
    if (form.settlementCurrency !== nextCurrency) {
      setForm((prev) => ({ ...prev, settlementCurrency: nextCurrency }));
    }
  }, [form.country, form.settlementCurrency]);

  useEffect(() => {
    if (!bannerMessage) return;
    const timer = window.setTimeout(() => setBannerMessage(null), 4200);
    return () => window.clearTimeout(timer);
  }, [bannerMessage]);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingOnboarding() {
      if (!isConnected || !isAuthenticated) {
        return;
      }

      setIsInitializing(true);
      const bootstrap = await bootstrapMemberAccount();
      if (!bootstrap) {
        if (!cancelled) {
          setBannerMessage("We couldn't initialize your member profile. Try reconnecting and signing in again.");
          setIsInitializing(false);
        }
        return;
      }

      const account = await getMemberAccountCenter();
      if (!account || cancelled) {
        setIsInitializing(false);
        return;
      }

      const onboardingStepIndex = ONBOARDING_STEPS.findIndex((step) => step.id === account.onboarding.currentStep);
      const membershipPlan = account.member.membershipPlan?.toLowerCase() as MembershipPlanId | undefined;
      const recoveryMethod = account.onboarding.recoveryMethod as RecoveryMethodId | null;
      const identityMode = account.onboarding.identityModeSelected as IdentityMode | null;
      const accessTrack = account.onboarding.accessTrack as AccessTrackId | null;
      const accountMethod = account.onboarding.accountMethod as AccountMethod | null;

      setCompletedAccount(account.onboarding.draftStatus === "submitted" ? account : null);
      setForm((prev) => ({
        ...prev,
        accessTrack: ACCESS_TRACKS.some((track) => track.id === accessTrack) ? (accessTrack as AccessTrackId) : prev.accessTrack,
        accountMethod: accountMethod === "wallet" || accountMethod === "appkit-account" || accountMethod === "anonymous-preview"
          ? accountMethod
          : prev.accountMethod,
        identityMode: IDENTITY_MODES.some((mode) => mode.id === identityMode) ? (identityMode as IdentityMode) : prev.identityMode,
        referralSource: account.onboarding.referralSource ?? prev.referralSource,
        inviteCode: account.onboarding.inviteCode ?? prev.inviteCode,
        incomeSource: account.onboarding.incomeSource ?? prev.incomeSource,
        reasons: account.onboarding.reasons.length > 0 ? account.onboarding.reasons : prev.reasons,
        goalsNote: account.onboarding.goalsNote ?? prev.goalsNote,
        username: account.profile.publicProfile.username ?? prev.username,
        legalName: account.profile.privateProfile?.legalName ?? prev.legalName,
        email: account.profile.privateProfile?.email ?? prev.email,
        phone: account.profile.privateProfile?.phone ?? prev.phone,
        cityRegion: account.profile.privateProfile?.cityRegion ?? prev.cityRegion,
        country: account.member.residencyCountry ?? prev.country,
        settlementCurrency: account.member.settlementCurrency ?? prev.settlementCurrency,
        membershipPlan:
          membershipPlan === "yearly" || membershipPlan === "lifetime"
            ? membershipPlan
            : prev.membershipPlan,
        recoveryMethod:
          recoveryMethod === "passkey" || recoveryMethod === "hardware" || recoveryMethod === "multisig"
            ? recoveryMethod
            : prev.recoveryMethod,
        notificationsOptIn: account.profile.publicProfile.notificationsOptIn,
        cardWaitlist: account.onboarding.cardWaitlist,
        localPools: account.onboarding.localPools,
        termsAccepted: account.terms.some((item) => item.documentType === "membership_terms"),
      }));

      if (onboardingStepIndex >= 0) {
        setCurrentStepIndex(onboardingStepIndex);
      }

      setIsInitializing(false);
    }

    void loadExistingOnboarding();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isConnected]);

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
    if (isInitializing) return "Loading your saved onboarding details.";
    if (canContinue) return "Ready to continue.";
    if (currentStep.id === "access") return "Choose how you'd like to get started.";
    if (currentStep.id === "setup") {
      return "Choose your privacy level, membership, and account preferences to continue.";
    }
    if (currentStep.id === "profile") {
      return form.identityMode === "anonymous"
        ? "Wallet-only onboarding requires username, city or region, and country."
        : "Complete username, email, city or region, and country to continue.";
    }
    return "Select a referral source, a primary income source, and at least one reason for joining.";
  }, [canContinue, currentStep.id, form.identityMode, isInitializing]);

  const updateField = <K extends keyof OnboardingFormState>(key: K, value: OnboardingFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const ensureAuthenticated = async () => {
    if (!isConnected || !isAuthenticated) {
      await openModal("Connect");
    }

    const authenticated = await checkAuthentication();
    if (!authenticated) {
      throw new Error("Connect and sign in with AppKit before finishing onboarding.");
    }
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

  const scrollToFormTop = () => {
    window.requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const submitOnboardingFlow = async () => {
    await ensureAuthenticated();

    const bootstrapped = await bootstrapMemberAccount();
    if (!bootstrapped) {
      throw new Error("We couldn't create your member record.");
    }

    const onboardingResult = await updateMemberOnboarding({
      currentStep: "discovery",
      accessTrack: form.accessTrack,
      accountMethod: form.accountMethod,
      identityModeSelected: form.identityMode,
      referralSource: form.referralSource,
      inviteCode: form.inviteCode || null,
      incomeSource: form.incomeSource,
      reasons: form.reasons,
      goalsNote: form.goalsNote || null,
      recoveryMethod: form.recoveryMethod,
      residencyCountry: form.country,
      settlementCurrency: form.settlementCurrency,
      membershipPlan: form.membershipPlan.toUpperCase() as "YEARLY" | "LIFETIME",
      cardWaitlist: form.cardWaitlist,
      localPools: form.localPools,
    });
    if (!onboardingResult) {
      throw new Error("We couldn't save your onboarding preferences.");
    }

    const profileResult = await updateMemberProfile({
      username: form.username,
      displayName: form.username,
      legalName: form.legalName || null,
      email: form.email || null,
      phone: form.phone || null,
      cityRegion: form.cityRegion,
      residencyCountry: form.country,
      settlementCurrency: form.settlementCurrency,
      notificationsOptIn: form.notificationsOptIn,
    });
    if (!profileResult) {
      throw new Error("We couldn't save your profile details.");
    }

    const termsResult = await acceptMemberTerms("membership_terms", "2026-03");
    if (!termsResult) {
      throw new Error("We couldn't record your membership terms acceptance.");
    }

    const account = await submitMemberOnboarding();
    if (!account) {
      throw new Error("We couldn't complete onboarding.");
    }

    setCompletedAccount(account);
    setIsComplete(true);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const handleMembershipCheckout = async () => {
    setIsCheckoutLoading(true);
    setBannerMessage(null);

    try {
      await ensureAuthenticated();
      const checkout = await createMemberMembershipCheckout({
        plan: form.membershipPlan.toUpperCase() as "YEARLY" | "LIFETIME",
        successUrl: `${window.location.origin}/account?tab=profile&membership=success`,
        cancelUrl: `${window.location.origin}/onboarding?membership=cancelled`,
      });

      if (!checkout?.session.url) {
        throw new Error("Stripe checkout didn't return a URL.");
      }

      window.location.assign(checkout.session.url);
    } catch (error) {
      console.error("Membership checkout error:", error);
      setBannerMessage(error instanceof Error ? error.message : "We couldn't start membership checkout.");
      setIsCheckoutLoading(false);
    }
  };

  const handleNext = async () => {
    if (!canContinue) return;
    if (currentStepIndex === ONBOARDING_STEPS.length - 1) {
      setIsSubmitting(true);
      setBannerMessage(null);
      try {
        await submitOnboardingFlow();
      } catch (error) {
        console.error("Onboarding submission failed:", error);
        setBannerMessage(error instanceof Error ? error.message : "We couldn't finish onboarding.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setCurrentStepIndex((prev) => Math.min(prev + 1, ONBOARDING_STEPS.length - 1));
    scrollToFormTop();
  };

  if (isComplete) {
    return (
      <div className="min-h-dvh bg-white text-black transition-colors duration-200 dark:bg-[#0e0e0e] dark:text-white">
        <div className="fixed inset-x-0 top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-900 dark:bg-[#0e0e0e]/80">
          <div className="container mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-sm border border-black/90 bg-white dark:border-white/10 dark:bg-[#0e0e0e]">
                <img src={ClearPathLogo} alt="ClearPath" className="h-full w-full object-cover" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">Clear</p>
                <p className="text-sm text-black dark:text-white">Onboarding</p>
              </div>
            </div>
            <Button
              type="button"
              className="rounded-md bg-black px-4 py-2 text-sm font-normal text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              onClick={() => navigate("/account?tab=profile")}
            >
              Open account center
            </Button>
          </div>
        </div>

        <main className="container mx-auto max-w-5xl px-4 pb-8 pt-24 sm:px-6 md:pb-10 md:pt-26">
          <div className="mt-10">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">User onboarding</p>
              <h1 className="mt-2 text-3xl font-light tracking-tight text-black dark:text-white sm:text-4xl">
                You're ready to continue with your Clear onboarding.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                Your member profile is saved. Review your selections below, then continue into the account center or start membership checkout.
              </p>
            </div>

            {bannerMessage ? (
              <div className="mt-6 border-y border-amber-500/30 bg-amber-500/10 px-0 py-3 text-[12px] leading-5 text-amber-800 dark:text-amber-300">
                {bannerMessage}
              </div>
            ) : null}

            <div className="mt-10 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
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
                    Next steps
                  </p>
                  <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                    {[
                      "Account profile saved and ready to review",
                      completedAccount?.member.membershipStatus === "ACTIVE"
                        ? "Membership is already active"
                        : "Use Stripe checkout to activate yearly or lifetime membership",
                      "Regulated rails stay locked until verification is approved",
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
                className="rounded-md border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
                onClick={() => {
                  setIsComplete(false);
                  setCurrentStepIndex(0);
                }}
              >
                Review onboarding
              </Button>
              <Button
                type="button"
                className="rounded-md bg-black px-4 py-2 text-sm font-normal text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                onClick={() => navigate("/account?tab=profile")}
              >
                Continue to account
              </Button>
              {completedAccount?.member.membershipStatus !== "ACTIVE" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-md border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
                  onClick={handleMembershipCheckout}
                  disabled={isCheckoutLoading}
                >
                  {isCheckoutLoading ? "Starting checkout..." : `Start ${selectedMembership.title}`}
                </Button>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-black transition-colors duration-200 dark:bg-[#0e0e0e] dark:text-white">
      <div className="fixed inset-x-0 top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-900 dark:bg-[#0e0e0e]/80">
        <div className="container mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-sm border border-black/90 bg-white dark:border-white/10 dark:bg-[#0e0e0e]">
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
              className="rounded-md border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
            >
              <Link to="/login">
                <ArrowLeft className="size-4" />
                Back
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <main className="container mx-auto max-w-6xl px-4 pb-5 pt-24 sm:px-6 md:pb-6 md:pt-26">
        {bannerMessage ? (
          <div className="mb-6 border-y border-amber-500/30 bg-amber-500/10 px-0 py-3 text-[12px] leading-5 text-amber-800 dark:text-amber-300">
            {bannerMessage}
          </div>
        ) : null}

        <div
          className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 md:overflow-visible"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex min-w-max gap-2 md:grid md:min-w-0 md:grid-cols-4 md:gap-3">
            {ONBOARDING_STEPS.map((step, index) => {
              const status = getStepStatus(index, currentStepIndex);
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStepIndex(index)}
                  className={cn(
                    "flex w-[168px] flex-none min-h-[84px] items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors md:w-auto md:min-h-[92px] md:min-w-0",
                    status === "current" &&
                      "border-sky-300 bg-[linear-gradient(180deg,rgba(240,249,255,0.96),rgba(236,253,245,0.7))] dark:border-sky-800 dark:bg-[linear-gradient(180deg,rgba(12,74,110,0.18),rgba(6,78,59,0.12))]",
                    status === "complete" &&
                      "border-emerald-300 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/20",
                    status === "upcoming" &&
                      "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-sm border bg-white text-black dark:bg-[#0e0e0e] dark:text-white",
                      status === "current" &&
                        "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
                      status === "complete" &&
                        "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
                      status === "upcoming" && "border-zinc-200 dark:border-zinc-800"
                    )}
                  >
                    <step.icon className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                      {step.label}
                    </p>
                    <p className="mt-1 text-sm font-medium leading-snug text-black dark:text-white sm:hidden">
                      {COMPACT_STEP_TITLES[step.id]}
                    </p>
                    <p className="mt-1 hidden text-sm font-medium leading-snug text-black dark:text-white sm:block">
                      {step.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <section
          ref={formSectionRef}
          className="mt-4 scroll-mt-24 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 md:scroll-mt-28"
        >
              <div className="border-b border-zinc-200 bg-[linear-gradient(90deg,rgba(240,249,255,0.9),rgba(255,255,255,1),rgba(255,251,235,0.9))] px-5 py-5 dark:border-zinc-800 dark:bg-[linear-gradient(90deg,rgba(8,47,73,0.18),rgba(14,14,14,1),rgba(120,53,15,0.12))] sm:px-8 sm:py-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                      {currentStep.label}
                    </p>
                    <h2 className="mt-1 text-xl font-medium tracking-tight text-black dark:text-white sm:text-2xl">
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
                            value={isConnected ? truncateAddress(address) : "Not connected yet"}
                          />
                          <SummaryRow label="Network" value={chainLabel} />
                          <SummaryRow label="Mode" value={selectedTrack.title} />
                        </div>

                        <div className="mt-6 space-y-3">
                          {[
                            "Choose a wallet or account sign-in that fits your setup",
                            "Start with a lighter profile and add more details later if you want",
                            "Unlock more features as your membership and profile are completed",
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
                            className="w-full rounded-md bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                            onClick={handleConnect}
                          >
                            Connect wallet or account
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
                              Tell us what matters most so we can personalize your first experience.
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
                                  "rounded-md border px-4 py-4 text-left transition-colors",
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
                          Choose the level of privacy and access that feels right for you today.
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
                                  "rounded-md border p-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex size-10 items-center justify-center rounded-sm border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
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
                          Compare yearly and lifetime membership so you can choose the plan that fits best.
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
                                  "rounded-md border p-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3">
                                    <div className="flex size-10 items-center justify-center rounded-sm border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
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
                                  "rounded-md border p-4 text-left transition-colors",
                                  active
                                    ? "border-black bg-zinc-50 dark:border-white dark:bg-zinc-900"
                                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                                )}
                              >
                                <div className="flex size-10 items-center justify-center rounded-sm border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
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
                              detail: "Turn this on if you'd like early access when card features become available.",
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
                          className="mt-6 flex cursor-pointer items-start gap-4 rounded-md border border-zinc-200 px-4 py-4 dark:border-zinc-800"
                        >
                          <Checkbox
                            id="terms-accepted"
                            checked={form.termsAccepted}
                            onCheckedChange={(checked) => updateField("termsAccepted", checked === true)}
                            className="mt-1 border-zinc-300 data-[state=checked]:border-black data-[state=checked]:bg-black data-[state=checked]:text-white dark:border-zinc-700 dark:data-[state=checked]:border-white dark:data-[state=checked]:bg-white dark:data-[state=checked]:text-black"
                          />
                            <div>
                              <p className="text-sm font-medium text-black dark:text-white">
                              Accept membership terms
                              </p>
                              <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                              By continuing, you agree to Clear's membership terms, disclosures, and account setup requirements.
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
                      className="rounded-md border-zinc-200 bg-white text-black hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white dark:hover:bg-zinc-900"
                      onClick={handleBack}
                      disabled={currentStepIndex === 0 || isSubmitting}
                    >
                      <ArrowLeft className="size-4" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      className="rounded-md bg-black text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
                      onClick={handleNext}
                      disabled={!canContinue || isSubmitting || isInitializing}
                    >
                      {isSubmitting
                        ? "Saving..."
                        : currentStepIndex === ONBOARDING_STEPS.length - 1
                          ? "Finish flow"
                          : "Continue"}
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 px-6 py-5 dark:border-zinc-800">
              <p className="text-sm font-medium text-black dark:text-white">Application summary</p>
              <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
                <SummaryRow label="Location" value={form.cityRegion.trim() ? `${form.cityRegion}, ${form.country}` : form.country} />
                <SummaryRow label="Currency" value={form.settlementCurrency} />
                <SummaryRow label="Reasons" value={form.reasons.length > 0 ? `${form.reasons.length} selected` : "None selected"} />
                <SummaryRow label="Recovery" value={RECOVERY_METHODS.find((item) => item.id === form.recoveryMethod)?.title ?? "Not selected"} />
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 px-6 py-5 dark:border-zinc-800">
              <p className="text-sm font-medium text-black dark:text-white">What to expect</p>
              <div className="mt-4 space-y-3">
                {[
                  {
                    icon: Globe,
                    text: "You can complete this flow comfortably on desktop or mobile with large, touch-friendly controls.",
                  },
                  {
                    icon: Landmark,
                    text: "Your local settlement currency is selected automatically from your country of residence.",
                  },
                  {
                    icon: CircleDollarSign,
                    text: "You can begin with a lighter setup and unlock more access as your profile is completed.",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.text} className="flex items-start gap-3">
                      <div className="flex size-9 items-center justify-center rounded-sm border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-[#0e0e0e] dark:text-white">
                        <Icon className="size-4" />
                      </div>
                      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
      </main>
    </div>
  );
}
