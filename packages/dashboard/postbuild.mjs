// A classic script (IIFE) also runs from file://, where module scripts are blocked.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const index = fileURLToPath(new URL('../pxsig/dist/dashboard/index.html', import.meta.url));
writeFileSync(index, readFileSync(index, 'utf8').replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>').replace(/ crossorigin/g, ''));
