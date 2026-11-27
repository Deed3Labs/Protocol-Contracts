/**
 * Where a member's links point: the member app for this environment, with no trailing slash.
 *
 * APP_PUBLIC_URL when it's set; otherwise APP_ORIGIN, the member app's origin the card screens
 * already use (the demo on dev, the live app on production); otherwise the live app. Before this,
 * a charge alert on dev said app.useclear.org, because only APP_PUBLIC_URL was read and dev
 * doesn't set it.
 */
export function memberAppUrl(): string {
  const set = (process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN || '').trim();
  return (set || 'https://app.useclear.org').replace(/\/+$/, '');
}
