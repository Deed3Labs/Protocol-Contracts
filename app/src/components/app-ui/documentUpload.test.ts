import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8');

/*
 * The claim on the screen is "Clear never sees the photo". These are what make it true rather than
 * reassuring, so they are worth pinning: the failure mode is silent — a forwarding endpoint added
 * later works perfectly and quietly makes us the custodian of every member's government ID.
 */
describe('an ID photo never reaches a server of ours', () => {
  const client = strip(read('utils/apiClient.ts'));
  const ui = strip(read('components/app-ui/DocumentUpload.tsx'));
  const routes = strip(
    readFileSync(join(import.meta.dirname, '..', '..', '..', 'server', 'src', 'routes', 'lithic.ts'), 'utf8'),
  );
  const service = strip(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'server', 'src', 'services', 'lithic', 'documentService.ts'),
      'utf8',
    ),
  );

  test('the image is PUT to the issuer, not posted to us', () => {
    const fn = client.slice(client.indexOf('export async function putDocumentImage'));
    expect(fn).toContain('fetch(uploadUrl');
    expect(fn).toContain("method: 'PUT'");
    // apiRequest would send it to our API and attach our session.
    expect(fn.slice(0, fn.indexOf('}\n'))).not.toContain('apiRequest');
  });

  test('and carries none of our session to somebody else’s storage', () => {
    const fn = client.slice(client.indexOf('export async function putDocumentImage'), client.indexOf('export async function getLithicAccount'));
    expect(fn).not.toMatch(/Authorization|credentials:/);
  });

  test('no route of ours accepts a file', () => {
    // The whole design collapses the moment one does.
    expect(routes).not.toMatch(/multer|multipart|upload\.single|req\.file/);
    const documentRoutes = routes.slice(routes.indexOf("router.get('/documents'"));
    expect(documentRoutes).not.toMatch(/req\.body\?\.(image|file|photo)/);
  });

  test('the server deals in tokens and URLs only', () => {
    expect(service).toContain('upload_url');
    // Nothing that would imply bytes passing through.
    expect(service).not.toMatch(/Buffer|arrayBuffer|createReadStream|fs\./);
  });

  test('only individual document types are reachable', () => {
    // The SDK's union includes business documents; a member should not be able to ask for those.
    const allowed = routes.slice(routes.indexOf('MEMBER_DOCUMENT_TYPES'), routes.indexOf("router.get('/documents'"));
    expect(allowed).toContain('DRIVERS_LICENSE');
    expect(allowed).not.toContain('EIN_LETTER');
  });

  test('how many images are needed is the issuer’s call, not ours', () => {
    /*
     * A licence wants two and a passport one, and hardcoding that pairing would be wrong the first
     * time the issuer changed its mind.
     *
     * The first version of this asserted `not.toMatch(/DRIVERS_LICENSE.*(FRONT|BACK)/s)` and failed
     * on a display-label map and a side-label map that merely coexist in the file. A loose negative
     * across a whole file catches coincidences; what matters is that the controls are derived from
     * what came back and nothing branches on the document type to decide.
     */
    expect(ui).toContain('targets.map');
    expect(ui).toContain('targets.every');
    const send = ui.slice(ui.indexOf('const choose ='), ui.indexOf('const allSent'));
    expect(send).not.toMatch(/documentType === '|chosenType === '/);
  });

  test('an expired URL is re-requested rather than cached for a retry', () => {
    // A cached upload URL is a live link to somewhere a passport can be written.
    const send = ui.slice(ui.indexOf('const send ='), ui.indexOf('const allSent'));
    expect(send).toContain('setChosenType(null)');
    expect(send).toContain('setTargets([])');
  });
});
