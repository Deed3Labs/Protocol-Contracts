import { Btn, CMain, Rows } from '@/components/clear/brand/anatomy';
import { Pane, TwoLineRow } from './SettingsKit';
import type { LoginEvent } from '@/lib/clearModel';

/**
 * Every sign-in, with what it was signed in with.
 *
 * The method matters as much as the device: with no password, "Face ID" and "Code" are two
 * different levels of proof. Sign out everywhere is the footer because it's the response, not the
 * page.
 */
export default function LoginHistoryPanel({ logins }: { logins: LoginEvent[] }) {
  return (
    <Pane
      label="Sign-ins"
      aside={<span className="c-det">{logins.length}</span>}
      foot={
        <>
          <p className="c-det">See something you don&rsquo;t recognize? Sign out everywhere and message support.</p>
          <Btn lg className="mt-s2">
            Sign out everywhere
          </Btn>
        </>
      }
    >
      <CMain>
        <Rows>
          {logins.map((event) => (
            <div key={event.id}>
              <TwoLineRow
                title={event.device}
                detail={event.detail}
                trailing={<span className="c-det shrink-0">{event.when}</span>}
              />
            </div>
          ))}
        </Rows>
      </CMain>
    </Pane>
  );
}
