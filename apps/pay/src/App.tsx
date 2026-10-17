import { useMemo } from 'react';
import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import type { Step } from './clear/Steps';
import { liveApi } from './lib/api';
import { PREVIEW } from './lib/env';
import { previewApi, previewModalApi, previewStep, type PreviewState } from './lib/preview';
import { LinkPage } from './link/LinkPage';
import { NoLink } from './link/LinkView';
import { ModalPage } from './modal/ModalPage';
import { Frames } from './preview/Frames';

function Link() {
  const [search] = useSearchParams();
  const state = (search.get('state') ?? 'open') as PreviewState;
  const api = useMemo(() => (PREVIEW ? previewApi(state) : liveApi), [state]);
  return <LinkPage api={api} />;
}

/** `?preview=1&step=enter|check|member|new|window|done|start` opens the preview's modal on that step. */
function Modal() {
  const [search] = useSearchParams();
  const step = search.get('step');
  const api = useMemo(() => (PREVIEW ? previewModalApi() : liveApi), []);
  const initial: Step | undefined = PREVIEW && step ? previewStep(step) : undefined;
  return <ModalPage api={api} initial={initial} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/l/:slug" element={<Link />} />
        <Route path="/m/:session" element={<Modal />} />
        {PREVIEW ? <Route path="/_frames" element={<Frames />} /> : null}
        <Route path="*" element={<NoLink />} />
      </Routes>
    </BrowserRouter>
  );
}
