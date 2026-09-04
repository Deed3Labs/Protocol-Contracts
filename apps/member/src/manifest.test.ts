import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'),
);
const APP = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

  test('the splash matches the app it opens into, rather than flashing the wrong one', () => {
    // App.tsx sets defaultTheme="light", whose --background is 245 245 245.
    expect(APP).toContain('defaultTheme="light"');
    expect(manifest.background_color).toBe('#f5f5f5');
    expect(INDEX).toContain('<meta name="theme-color" content="#f5f5f5" />');
  });

  test('icons declare the size they actually are', () => {
    // One 500x500 source. Declaring it at eight sizes invited a browser to pick a blurry one.
    for (const icon of manifest.icons) expect(icon.sizes).toBe('500x500');
  });

  test('nothing points at a file that is not shipped', () => {
    expect(INDEX).not.toContain('browserconfig.xml');
  });
});
