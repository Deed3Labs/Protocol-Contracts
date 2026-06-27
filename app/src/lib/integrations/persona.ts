import { INTEGRATIONS_LIVE, apiPost } from './client';

/*
 * Persona identity verification. Real flow: the backend creates an inquiry (or returns a
 * one-time link) → the client runs the Persona Inquiry SDK (persona-react <Inquiry>) → on
 * complete we hand the inquiry id to Bridge (see bridge.createCustomer). A Persona webhook on the
 * backend is the source of truth for inquiry status.
 *
 * SEAM: replace KycModal's mocked verifying step with the Persona Inquiry SDK using this inquiry.
 */

export interface PersonaInquiry {
  inquiryId: string;
  /** When live, a one-time URL/template the Inquiry SDK opens. */
  sessionToken?: string;
}

export async function createInquiry(): Promise<PersonaInquiry> {
  if (INTEGRATIONS_LIVE) return apiPost<PersonaInquiry>('/persona/inquiries', {});
  return { inquiryId: `inq_mock_${Date.now().toString(36)}` };
}
