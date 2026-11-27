/**
 * iOS zooms into a text field under 16px the moment it's tapped, and the page stays zoomed.
 *
 * `maximum-scale=1` stops that, and on iOS only: since iOS 10 Safari ignores the cap for pinching,
 * so people can still pinch to zoom. Elsewhere (Android) the cap would stop pinching too, and nothing
 * zooms on focus there anyway, so the viewport is left alone. This replaces forcing every field to
 * 16px on iOS, which changed the design's field sizes to get the same thing.
 *
 * iPadOS reports itself as a Mac, so a Mac with a touch screen counts as an iPad.
 */
export function stopIosFieldZoom(): void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta && !/maximum-scale/.test(meta.content)) meta.content = `${meta.content}, maximum-scale=1`;
}
