import { OnboardingFlow, submitClearOnboarding, type OnboardingStep, type OnboardingValues } from '@clear/member-kit';
import type { PublicShopApp } from '@clear/merchant-contracts';
import { useState } from 'react';
import { useData } from '../data/context';
import { ClearMark, Close } from '../icons';
import { CLEAR_LOOK } from '../lib/brand';
import { Sheet } from '../shell/ui';
import { shortName, word } from '../screens/parts';

/**
 * Set up your Clear account (section 5): Clear's own onboarding, in Clear's paper, inside the app,
 * returning where it started. The steps are the Clear app's (packages/member-kit), and so is the
 * submit chain, so a Clear account made here is the same as one made in Clear.
 */
export function SetUpClearSheet({ shop, points, onClose }: { shop: PublicShopApp; points: number; onClose: () => void }) {
  const data = useData();
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState<OnboardingStep>('join');
  const [values, setValues] = useState<OnboardingValues>({ contact: '', code: '', zip: '', invite: shop.slug.toUpperCase(), email: '' });
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await submitClearOnboarding(data.onboarding, values, { referralSource: 'rewards' });
      onClose();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t finish setting up Clear.');
    }
  }

  return (
    <Sheet full onClose={onClose} look={CLEAR_LOOK}>
      <div className="sa-sh">
        <p className="sa-cl">
          <ClearMark width={14} height={14} />
          <b>Clear</b>
        </p>
        <button className="sa-switch" aria-label="Close" onClick={onClose}>
          <Close />
        </button>
      </div>
      {!started ? (
        <>
          <div className="sa-m">
            <p className="sa-big2" style={{ textAlign: 'left' }}>
              Set up your Clear account
            </p>
            <p className="det">Clear is a member-owned co-op. Your account works in this app, the Clear app, and at every Clear shop.</p>
          </div>
          <div className="sa-m sa-steps">
            <p>
              <b>1</b>Confirm it’s you<span>Name, date of birth, address</span>
            </p>
            <p>
              <b>2</b>Link your bank<span>To add money and to pay</span>
            </p>
            <p>
              <b>3</b>You’re in<span>
                Back to {shortName(shop.name)}, with your {points} {word(shop.pointsName, points)}
              </span>
            </p>
          </div>
          <div className="sa-m">
            <button className="sa-btn k wide" onClick={() => setStarted(true)}>
              Start
            </button>
            <p className="sa-sub">The same steps as the Clear app. Clear’s screens, not the shop’s.</p>
          </div>
        </>
      ) : (
        <div className="r-clear-flow">
          <OnboardingFlow
            step={step}
            onStepChange={(next) => {
              // Identity is deferred to the first deposit in the Clear app too: reaching it submits.
              if (next === 'identity') void submit();
              else setStep(next);
            }}
            values={values}
            onValuesChange={(p) => setValues((v) => ({ ...v, ...p }))}
          />
          {error ? <p className="r-err" style={{ padding: '0 16px' }}>{error}</p> : null}
        </div>
      )}
    </Sheet>
  );
}
