#!/usr/bin/env node
/**
 * build.mjs — construit `dist/bundle.js`, le bundle qu'exécute la page bac à
 * sable de Filarr. Commun aux dix exemples avec code.
 *
 *   node ../_outils/build.mjs            (depuis le dossier d'un exemple)
 *   node _outils/build.mjs compteur-mots (depuis examples/code)
 *
 * LES CONTRAINTES DE LA CIBLE, et ce qu'elles imposent ici :
 *
 *  - **IIFE, pas ESM.** La page exécute `new Function('globalThis', code)` :
 *    le bundle est un CORPS DE FONCTION, où `import`/`export` sont des erreurs
 *    de syntaxe. Un bundle ESM donne `sandbox_no_plugin` au montage.
 *  - **`es2020`.** L'iframe tourne dans le navigateur de l'utilisateur.
 *  - **Sortie ASCII.** Le bundle voyage en octets jusqu'à IndexedDB puis en
 *    chaîne : accents et emoji échappés, plus aucune question d'encodage.
 *  - **Aucun réseau.** Tout est embarqué (Yjs compris pour le tableau blanc) :
 *    la CSP de la page refuse tout chargement, `importScripts` compris.
 *
 * LES WORKERS. `import source from './x.worker.ts?worker'` construit ce
 * fichier À PART, en IIFE, et l'importe comme TEXTE. L'exemple en fait un
 * `Blob`, puis un `Worker` depuis son URL `blob:` — la seule source que la CSP
 * permet (`worker-src blob:`). Le worker hérite de la CSP : pas de réseau.
 *
 * LES GARDES, parce qu'un bundle cassé ne se voit qu'à l'ouverture d'un fichier,
 * chez quelqu'un d'autre : le code se compile comme corps de fonction (donc ni
 * `import` ni `export` résiduel), aucun `import()` dynamique, taille ≤ 4 Mio
 * (avertissement au-delà de 1 Mio). Un bundle refusé est EFFACÉ : laissé sur le
 * disque, il finirait empaqueté par l'outil suivant.
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTILS = dirname(fileURLToPath(import.meta.url));
/** Le plafond de l'hôte (`MAX_PLUGIN_BUNDLE_BYTES`, PUBLISHING.md §2). */
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
/** Au-delà, on prévient : API.md conseille de viser 1 Mio pour garder de la marge. */
const CONSEIL_BUNDLE_BYTES = 1024 * 1024;

/** Le dossier de l'exemple : l'argument, sinon le dossier courant. */
export function dossierExemple(arg) {
  const candidat = arg ? resolve(process.cwd(), arg) : process.cwd();
  if (existsSync(join(candidat, 'filarr.extension.json'))) return candidat;
  const voisin = join(OUTILS, '..', arg ?? '');
  if (arg && existsSync(join(voisin, 'filarr.extension.json'))) return voisin;
  throw new Error(`aucun filarr.extension.json dans ${candidat}`);
}

/** Les options esbuild partagées par le bundle et ses workers. */
const OPTIONS_CIBLE = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  charset: 'ascii',
  legalComments: 'none',
  logLevel: 'silent',
};

/** `?worker` : construit le fichier à part et l'importe comme une chaîne. */
const greffonWorker = {
  name: 'filarr-worker-texte',
  setup(b) {
    b.onResolve({ filter: /\?worker$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?worker$/, '')),
      namespace: 'filarr-worker',
    }));
    b.onLoad({ filter: /.*/, namespace: 'filarr-worker' }, async (args) => {
      const sortie = await build({ ...OPTIONS_CIBLE, entryPoints: [args.path], write: false });
      const code = sortie.outputFiles[0].text;
      verifierCorps(code, `worker ${args.path}`);
      return {
        contents: `export default ${JSON.stringify(code)};`,
        loader: 'js',
        watchFiles: [args.path],
      };
    });
  },
};

/**
 * Le code se compile-t-il comme CORPS DE FONCTION ? C'est exactement ce que
 * fait la page : un `import`/`export` statique ou un `import.meta` y est une
 * erreur de syntaxe. On compile sans exécuter.
 */
export function verifierCorps(code, quoi = 'bundle') {
  try {
    // eslint-disable-next-line no-new-func
    new Function('globalThis', code);
  } catch (e) {
    throw new Error(`${quoi} : ne se compile pas comme corps de fonction (${e.message}) — import/export résiduel ?`);
  }
  // Un import() dynamique se compile, mais il voudrait charger un module : la
  // CSP le refusera chez l'utilisateur. On le refuse ici.
  if (/\bimport\s*\(/.test(code)) {
    throw new Error(`${quoi} : import() dynamique — la page bac à sable n'a aucun réseau`);
  }
}

export async function construire(dossier) {
  const config = JSON.parse(readFileSync(join(dossier, 'filarr.extension.json'), 'utf8'));
  const entree = config?.build?.entry ?? 'src/index.ts';
  const sortie = join(dossier, 'dist', 'bundle.js');
  mkdirSync(dirname(sortie), { recursive: true });

  try {
    await build({
      ...OPTIONS_CIBLE,
      entryPoints: [join(dossier, entree)],
      outfile: sortie,
      plugins: [greffonWorker],
      logLevel: 'warning',
    });
    const octets = readFileSync(sortie);
    if (octets.byteLength === 0) throw new Error('bundle vide');
    if (octets.byteLength > MAX_BUNDLE_BYTES) {
      throw new Error(`bundle de ${taille(octets.byteLength)} — l'hôte refuse au-delà de 4 Mio`);
    }
    verifierCorps(octets.toString('utf8'));
    return { sortie, octets: octets.byteLength, sha256: createHash('sha256').update(octets).digest('hex') };
  } catch (e) {
    rmSync(sortie, { force: true });
    throw e;
  }
}

export function taille(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Kio`;
  return `${(n / 1024 / 1024).toFixed(2)} Mio`;
}

// Exécuté directement (pas importé par check.mjs ou smoke.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dossier = dossierExemple(process.argv[2]);
    const r = await construire(dossier);
    console.log(`dist/bundle.js  ${taille(r.octets)}`);
    console.log(`sha256          ${r.sha256}`);
    if (r.octets > CONSEIL_BUNDLE_BYTES) {
      console.warn(`attention : plus de ${taille(CONSEIL_BUNDLE_BYTES)} — visez moins pour garder de la marge`);
    }
  } catch (e) {
    console.error(`Build refusé : ${e.message}`);
    process.exit(1);
  }
}
