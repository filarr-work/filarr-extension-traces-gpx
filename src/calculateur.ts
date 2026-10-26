/**
 * calculateur — lance le Web Worker depuis un `blob:`, et s'en passe s'il le faut.
 *
 * Le worker est une OPTIMISATION, jamais une condition : si `Worker` manque, si
 * sa création est refusée ou s'il tombe, le même calcul (`calculerProfil`) se
 * fait sur le fil principal. L'utilisateur voit son profil dans tous les cas.
 *
 * `detruire()` termine le worker ET révoque l'URL `blob:` : l'un sans l'autre,
 * c'est une fuite qui survit à chaque ouverture de fichier dans la session.
 */

import source from './calcul.worker.ts?worker';
import { calculerProfil, type Profil, type SegmentBrut } from './profil';

export interface Calculateur {
  calculer(segments: SegmentBrut[]): Promise<Profil>;
  /** Vrai si le calcul part vraiment dans un worker. */
  readonly enWorker: boolean;
  detruire(): void;
}

interface Attente {
  segments: SegmentBrut[];
  resolve(p: Profil): void;
  reject(e: Error): void;
}

export function creerCalculateur(): Calculateur {
  let worker: Worker | null = null;
  let url: string | null = null;
  const attente = new Map<number, Attente>();
  let suivant = 1;

  const local = (a: Attente) => {
    try {
      a.resolve(calculerProfil(a.segments));
    } catch (e) {
      a.reject(e as Error);
    }
  };

  /** Le worker est tombé : on le lâche, et ce qui attendait se calcule ici. */
  const replier = () => {
    worker?.terminate();
    worker = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    const enCours = [...attente.values()];
    attente.clear();
    enCours.forEach(local);
  };

  try {
    if (typeof Worker !== 'undefined' && typeof URL.createObjectURL === 'function') {
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e: MessageEvent<{ id: number; profil?: Profil; erreur?: string }>) => {
        const a = attente.get(e.data.id);
        if (!a) return;
        attente.delete(e.data.id);
        if (e.data.profil) a.resolve(e.data.profil);
        else local(a);
      };
      worker.onerror = () => replier();
    }
  } catch {
    replier();
  }

  return {
    get enWorker() {
      return worker !== null;
    },
    calculer(segments) {
      return new Promise<Profil>((resolve, reject) => {
        const a: Attente = { segments, resolve, reject };
        if (!worker) {
          local(a);
          return;
        }
        const id = suivant++;
        attente.set(id, a);
        worker.postMessage({ id, segments });
      });
    },
    detruire() {
      attente.clear();
      worker?.terminate();
      worker = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}
