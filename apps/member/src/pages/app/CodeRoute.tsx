import CodePage from './CodePage';
import { useSendData } from './SendRoute';

/** Live full-screen code — the member's own handle and balances. */
export default function CodeRoute() {
  return <CodePage data={useSendData()} />;
}
