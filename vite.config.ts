import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { transform as esbuildTransform } from 'esbuild';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function rnJsxPlugin(): Plugin {
  const rootAppJs = path.resolve(__dirname, 'App.js');
  const wifiServiceJs = path.resolve(__dirname, 'src/services/WifiControl.js');
  const browserTouchpadJs = path.resolve(
    __dirname,
    'src/components/TvBrowserTouchpadModal.js'
  );
  const cinemaControlModalJs = path.resolve(
    __dirname,
    'src/components/CinemaControlModal.js'
  );
  const dlnaCastModalJs = path.resolve(
    __dirname,
    'src/components/DlnaCastModal.js'
  );

  return {
    name: 'rn-jsx-loader',
    enforce: 'pre',
    async transform(code, id) {
      const cleanId = id.split('?')[0];
      if (
        cleanId === rootAppJs ||
        cleanId === wifiServiceJs ||
        cleanId === browserTouchpadJs ||
        cleanId === cinemaControlModalJs ||
        cleanId === dlnaCastModalJs
      ) {
        const result = await esbuildTransform(code, {
          loader: 'jsx',
          jsx: 'automatic',
          sourcefile: cleanId,
          sourcemap: true,
        });
        return {
          code: result.code,
          map: result.map,
        };
      }
      return null;
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [rnJsxPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'react-native': path.resolve(__dirname, 'src/web-shims/react-native-shim.tsx'),
        '@react-native-async-storage/async-storage': path.resolve(
          __dirname,
          'src/web-shims/async-storage-shim.ts'
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
