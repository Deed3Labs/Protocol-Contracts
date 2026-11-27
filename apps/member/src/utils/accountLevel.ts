export const ACCOUNT_LEVELS = [
  { label: 'Scout', min: 0, max: 499 },
  { label: 'Navigator', min: 500, max: 849 },
  { label: 'Curator', min: 850, max: 1199 },
  { label: 'Steward', min: 1200, max: 1599 },
  { label: 'Prime', min: 1600, max: 9999 },
] as const;

export interface AccountLevelComputationInput {
  legalName: string;
  displayName: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
  walletCount: number;
  socialCount: number;
  bankCount: number;
  securityEnabledCount: number;
  securityControlCount: number;
  hasSavedProfile: boolean;
}

export interface AccountLevelMetrics {
  profileFieldsComplete: number;
  linkedAccountGroupCount: number;
  profileProgress: number;
  connectionProgress: number;
  securityScore: number;
  supportChecklistCount: number;
  supportProgress: number;
  profileCompletion: number;
  unlockedAchievementCount: number;
  unlockedPerkCount: number;
  completedTaskCount: number;
  accountXp: number;
  levelLabel: string;
  levelNumber: number;
  levelProgress: number;
  pointsToNextLevel: number;
}

const clampPercent = (value: number) => Math.max(0, Math.min(Math.round(value), 100));

export function computeAccountLevelMetrics(input: AccountLevelComputationInput): AccountLevelMetrics {
  const profileFieldsComplete = [
    input.legalName.trim(),
    input.displayName.trim(),
    input.email.trim(),
    input.phone.trim(),
    input.location.trim(),
    input.bio.trim(),
  ].filter(Boolean).length;

  const linkedAccountGroupCount = [
    input.walletCount > 0,
    input.socialCount > 0,
    input.bankCount > 0,
  ].filter(Boolean).length;

  const profileProgress = clampPercent((profileFieldsComplete / 6) * 100);
  const connectionProgress = clampPercent((linkedAccountGroupCount / 3) * 100);
  const securityScore = clampPercent((input.securityEnabledCount / input.securityControlCount) * 100);

  const supportChecklistCount =
    Number(input.hasSavedProfile) +
    Number(Boolean(input.email.trim())) +
    Number(Boolean(input.phone.trim())) +
    Number(input.securityEnabledCount >= 4);

  const supportProgress = clampPercent(supportChecklistCount * 25);

  const profileCompletion = clampPercent(
    ([
      Boolean(input.legalName.trim()),
      Boolean(input.displayName.trim()),
      Boolean(input.email.trim()),
      Boolean(input.phone.trim()),
      Boolean(input.location.trim()),
      Boolean(input.bio.trim()),
      input.walletCount > 0,
      input.socialCount > 0,
      input.bankCount > 0,
      input.securityEnabledCount >= 4,
    ].filter(Boolean).length / 10) * 100
  );

  const unlockedAchievementCount = [
    profileProgress === 100,
    input.walletCount >= 2,
    input.socialCount >= 1,
    input.securityEnabledCount >= 4,
    input.bankCount >= 1,
    input.hasSavedProfile,
  ].filter(Boolean).length;

  const unlockedPerkCount = [
    input.securityEnabledCount >= 4,
    profileCompletion >= 80 && input.socialCount > 0,
    Boolean(input.email.trim() && input.phone.trim() && input.walletCount > 0),
  ].filter(Boolean).length;

  const remainingProfileFields = Math.max(6 - profileFieldsComplete, 0);
  const missingConnections = Math.max(3 - linkedAccountGroupCount, 0);
  const protectionsToGoal = Math.max(4 - input.securityEnabledCount, 0);
  const recoveryStepsLeft = Math.max(4 - supportChecklistCount, 0);
  const completedTaskCount = [
    remainingProfileFields === 0,
    missingConnections === 0,
    protectionsToGoal === 0,
    recoveryStepsLeft === 0,
  ].filter(Boolean).length;

  const accountXp =
    profileCompletion * 9 +
    input.securityEnabledCount * 50 +
    completedTaskCount * 150 +
    unlockedAchievementCount * 40 +
    unlockedPerkCount * 45 +
    linkedAccountGroupCount * 45 +
    Number(input.hasSavedProfile) * 35;

  const levelIndex = ACCOUNT_LEVELS.findIndex((level) => accountXp >= level.min && accountXp <= level.max);
  const currentLevel = ACCOUNT_LEVELS[levelIndex >= 0 ? levelIndex : 0];
  const nextLevel = ACCOUNT_LEVELS[Math.min((levelIndex >= 0 ? levelIndex : 0) + 1, ACCOUNT_LEVELS.length - 1)];
  const levelFloor = currentLevel.min;
  const levelCeiling = currentLevel.max;
  const levelProgress = currentLevel.label === nextLevel.label
    ? 100
    : clampPercent(((accountXp - levelFloor) / (levelCeiling - levelFloor + 1)) * 100);
  const pointsToNextLevel = currentLevel.label === nextLevel.label ? 0 : Math.max(nextLevel.min - accountXp, 0);

  return {
    profileFieldsComplete,
    linkedAccountGroupCount,
    profileProgress,
    connectionProgress,
    securityScore,
    supportChecklistCount,
    supportProgress,
    profileCompletion,
    unlockedAchievementCount,
    unlockedPerkCount,
    completedTaskCount,
    accountXp,
    levelLabel: currentLevel.label,
    levelNumber: Math.min((levelIndex >= 0 ? levelIndex : 0) + 1, ACCOUNT_LEVELS.length),
    levelProgress,
    pointsToNextLevel,
  };
}
