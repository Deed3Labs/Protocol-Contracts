import { useMemo } from 'react';
import { BrowserRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { liveApi } from './lib/api';
import { PREVIEW } from './lib/env';
import { previewApi, type PreviewState } from './lib/preview';
import { LinkPage } from './link/LinkPage';
import { NoLink } from './link/LinkView';
import { Frames } from './preview/Frames';

function Link() {
  const [search] = useSearchParams();
  const state = (search.get('state') ?? 'open') as PreviewState;
  const api = useMemo(() => (PREVIEW ? previewApi(state) : liveApi), [state]);
  return <LinkPage api={api} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/l/:slug" element={<Link />} />
        {PREVIEW ? <Route path="/_frames" element={<Frames />} /> : null}
        <Route path="*" element={<NoLink />} />
      </Routes>
    </BrowserRouter>
  );
}
