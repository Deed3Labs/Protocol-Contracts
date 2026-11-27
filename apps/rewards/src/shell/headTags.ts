/**
 * The page's name, manifest and icon, set from the shop's config once its address is read. Chrome
 * reads the manifest, and Safari the title and touch icon, when they're added to a home screen, which
 * is after this has run, so each shop's link installs as its own app (rewards DECISIONS, Phase 4).
 */
export function setHead(input: { title: string; manifest: string; themeColor: string; icon: string | null }): void {
  document.title = input.title;
  const link = (rel: string) => {
    let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement('link');
      el.rel = rel;
      document.head.appendChild(el);
    }
    return el;
  };
  link('manifest').href = input.manifest;
  if (input.icon) link('apple-touch-icon').href = input.icon;
  const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = input.themeColor;
  let appTitle = document.head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (!appTitle) {
    appTitle = document.createElement('meta');
    appTitle.name = 'apple-mobile-web-app-title';
    document.head.appendChild(appTitle);
  }
  appTitle.content = input.title;
}
