import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { transformSync } from 'esbuild';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function rootAppJsxPlugin(): Plugin {
  const rootAppPath = path.resolve(__dirname, 'App.js');
  const rnComponentsDir = path.resolve(__dirname, 'src/components') + path.sep;
  return {
    name: 'root-app-js-jsx',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?')[0];
      const resolvedId = path.resolve(cleanId);
      if (
        resolvedId === rootAppPath ||
        (resolvedId.startsWith(rnComponentsDir) && resolvedId.endsWith('.js'))
      ) {
        const result = transformSync(code, {
          loader: 'jsx',
          jsx: 'automatic',
          sourcefile: cleanId,
        });
        return {
          code: result.code,
          map: result.map || null,
        };
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [rootAppJsxPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react-native': path.resolve(__dirname, 'src/web-shims/react-native.tsx'),
        '@react-native-async-storage/async-storage': path.resolve(
          __dirname,
          'src/web-shims/async-storage.ts'
        ),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
