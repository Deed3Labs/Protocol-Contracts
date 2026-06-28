/*
 * Embedded Persona identity verification via the CDN widget + window.Persona.Client (the same
 * CDN-script pattern as Plaid/Stripe here — no npm dep, stays in-app, no hosted redirect).
 *
 * Env (placeholders until you have them): VITE_PERSONA_TEMPLATE_ID, VITE_PERSONA_ENVIRONMENT_ID.
 * When the template id is unset, PERSONA_CONFIGURED is false and KycModal falls back to its mock
 * verifying step so the prototype keeps working.
 *
 * Backend (next): a Persona webhook is the source of truth for inquiry status; the completed
 * inquiry id is handed to Bridge customer creation (persona_inquiry_type) — see lib/integrations.
 */
declare global {
  interface Window {
    Persona?: {
      Client: new (opts: {
        templateId?: string;
        environmentId?: string;
        referenceId?: string;
        onReady?: () => void;
        onComplete?: (props: { inquiryId: string; status: string; fields?: unknown }) => void;
        onCancel?: (props: { inquiryId?: string; sessionToken?: string }) => void;
        onError?: (error: { code?: string; message?: string }) => void;
      }) => { open: () => void };
    };
  }
}

const env = import.meta.env as unknown as Record<string, string | undefined>;
const TEMPLATE_ID = env.VITE_PERSONA_TEMPLATE_ID;
const ENVIRONMENT_ID = env.VITE_PERSONA_ENVIRONMENT_ID;
const PERSONA_VERSION = 'persona-v5.1.2';

export const PERSONA_CONFIGURED = Boolean(TEMPLATE_ID);

export interface PersonaResult {
  inquiryId: string;
  status?: string;
}

function loadPersonaScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Persona) return resolve();
    const waitForGlobal = () => {
      const start = Date.now();
      const check = setInterval(() => {
        if (window.Persona) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - start > 10000) {
          clearInterval(check);
          reject(new Error('Persona script failed to load'));
        }
      }, 100);
    };
    if (document.querySelector('script[src*="withpersona.com/dist"]')) return waitForGlobal();
    const script = document.createElement('script');
    script.src = `https://cdn.withpersona.com/dist/${PERSONA_VERSION}.js`;
    script.async = true;
    script.onload = waitForGlobal;
    script.onerror = () => reject(new Error('Failed to load Persona script'));
    document.head.appendChild(script);
  });
}

/** Launch the embedded Persona inquiry. Resolves the inquiry id on completion, null if cancelled. */
export async function runPersonaInquiry(referenceId?: string): Promise<PersonaResult | null> {
  await loadPersonaScript();
  if (!window.Persona) throw new Error('Persona is unavailable');
  return new Promise<PersonaResult | null>((resolve, reject) => {
    let done = false;
    const client = new window.Persona!.Client({
      templateId: TEMPLATE_ID,
      environmentId: ENVIRONMENT_ID,
      ...(referenceId ? { referenceId } : {}),
      onReady: () => client.open(),
      onComplete: ({ inquiryId, status }) => {
        done = true;
        resolve({ inquiryId, status });
      },
      onCancel: () => {
        if (!done) resolve(null);
      },
      onError: (error) => reject(new Error(error?.message || 'Persona error')),
    });
  });
}
