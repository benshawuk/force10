import { createInertiaApp } from '@inertiajs/react';
import { createRoot } from 'react-dom/client';
import { initForce10 } from '@force10/client';
import manifest from './force10-manifest';

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./pages/**/*.tsx', { eager: true });
    return pages[`./pages/${name}.tsx`];
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});

initForce10(manifest, { debug: true });
