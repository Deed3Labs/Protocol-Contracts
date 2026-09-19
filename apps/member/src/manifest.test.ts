import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'),
);
const APP = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SPLASH_CSS = readFileSync(new URL('./styles/clear-components.css', import.meta.url), 'utf8');

/**
 * The manifest is the only part of the app the browser reads before there is an app, and the last
 * one anybody opens. It had drifted a whole product behind — shortcuts to pages that no longer
 * existed, and a start_url pointing at another origin.
 */
describe('the manifest describes this app', () => {
  test('every shortcut goes somewhere that exists', () => {
    for (const s of manifest.shortcuts ?? []) {
      expect(APP).toContain(`path="${s.url}"`);
    }
  });

  test('the share target goes somewhere that exists', () => {
    if (manifest.share_target) expect(APP).toContain(`path="${manifest.share_target.action}"`);
    // Chrome warns when a share target leaves enctype to its default; state the default.
    if (manifest.share_target) expect(manifest.share_target.enctype).toBe('application/x-www-form-urlencoded');
  });

  test('start_url and scope are relative, so preview and production each get their own', () => {
    // An absolute start_url on another origin is invalid and silently discarded.
    expect(manifest.start_url.startsWith('/')).toBe(true);
    expect(manifest.scope.startsWith('/')).toBe(true);
  });

  test('an explicit id, so identity does not move when start_url does', () => {
    expect(manifest.id).toBeString();
  });

  test('a scanned link navigates the open app rather than stacking a second one', () => {
    expect(manifest.launch_handler?.client_mode).toBe('navigate-existing');
  });

  /*
   * The OS paints its splash from background_color before any JavaScript runs, and that value is
   * static. Our own splash is therefore ink in every theme: if it followed the theme, a light
   * member would get ink, then paper, then the app — two colour changes on a cold open, the first
   * of which looks like a fault. Change one of these and you have to change the other.
   */
  test('both splashes are the same ink, so a cold open changes colour once', () => {
    expect(manifest.background_color).toBe('#16211D');
    expect(SPLASH_CSS).toContain('background:#16211D');
  });

  test('browser chrome follows the theme, which the manifest cannot', () => {
    expect(INDEX).toContain('content="#DFE3DE" media="(prefers-color-scheme: light)"');
    expect(INDEX).toContain('content="#16211D" media="(prefers-color-scheme: dark)"');
  });

  test('icons declare the size they actually are', () => {
    // Read from the PNG itself rather than trusted: a declared size a browser then finds wrong is
    // how it ends up picking the blurry one.
    for (const icon of manifest.icons) {
      const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
      const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
      expect(size).toBe(icon.sizes);
    }
  });

  test('a maskable icon is declared, because a launcher will crop whatever it gets', () => {
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  test('nothing points at a file that is not shipped', () => {
    expect(INDEX).not.toContain('browserconfig.xml');
  });
});
