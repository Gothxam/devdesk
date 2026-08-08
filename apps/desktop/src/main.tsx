import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Shell } from './shell';

const container = document.getElementById('root');
if (!container) {
  throw new Error('DevDesk shell: #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
