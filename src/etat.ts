/**
 * etat — la barre d'état de l'enregistrement : un `role="status"` pour ce qui
 * se passe (« Enregistré à 14:02 ») et un `role="alert"` pour ce qui demande
 * une action (conflit, lecture seule découverte, refus de l'hôte).
 *
 * Deux régions séparées parce qu'elles ne se lisent pas pareil : un lecteur
 * d'écran annonce poliment un statut, il interrompt pour une alerte. Recopié
 * dans chaque exemple.
 */

import { el } from './dom';
import type { EtatSauvegarde } from './sauvegarde';

export interface TextesEtat {
  modifie: string;
  enregistrement: string;
  enregistre: (heure: string) => string;
  /** Affiché en permanence quand le document s'ouvre en lecture seule. */
  lectureSeule: string;
  conflit: string;
  refusLectureSeule: string;
  erreur: (code: string) => string;
}

export interface BarreEtat {
  statut: HTMLElement;
  alerte: HTMLElement;
  afficher(etat: EtatSauvegarde): void;
}

export function creerBarreEtat(t: TextesEtat, langue: string, lectureSeule: boolean): BarreEtat {
  const statut = el('span', { classe: 'etat-statut', attrs: { role: 'status' } });
  const alerte = el('div', { classe: 'etat-alerte', attrs: { role: 'alert' } });
  alerte.hidden = true;
  if (lectureSeule) statut.textContent = t.lectureSeule;

  const alerter = (texte: string | null) => {
    alerte.textContent = texte ?? '';
    alerte.hidden = texte === null;
  };

  return {
    statut,
    alerte,
    afficher(etat) {
      switch (etat.type) {
        case 'propre':
          statut.textContent = '';
          break;
        case 'modifie':
          statut.textContent = t.modifie;
          break;
        case 'enregistrement':
          statut.textContent = t.enregistrement;
          alerter(null);
          break;
        case 'enregistre':
          statut.textContent = t.enregistre(
            etat.quand.toLocaleTimeString(langue, { hour: '2-digit', minute: '2-digit' })
          );
          alerter(null);
          break;
        case 'conflit':
          statut.textContent = t.modifie;
          alerter(t.conflit);
          break;
        case 'lecture_seule':
          statut.textContent = t.lectureSeule;
          alerter(t.refusLectureSeule);
          break;
        case 'erreur':
          statut.textContent = t.modifie;
          // Le code tel quel : l'utilisateur pourra le rapporter.
          alerter(t.erreur(etat.code));
          break;
      }
    },
  };
}
