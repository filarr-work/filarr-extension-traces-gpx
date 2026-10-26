/**
 * sauvegarde — l'enregistrement automatique, SANS DOM (donc testable seul).
 *
 * Le même module est recopié dans chaque exemple : un exemple doit se lire et
 * se copier d'un seul tenant. Ce qu'il tient du contrat (API.md §3) :
 *
 *  - `onDirty(true)` à CHAQUE mutation : l'hôte baisse son drapeau quand une
 *    sauvegarde réussit, y compris celle que l'utilisateur lance depuis la
 *    modale ; un plugin qui n'annonce la saleté qu'une fois finit « propre »
 *    aux yeux de l'hôte alors qu'il ne l'est pas ;
 *  - `onDirty(false)` seulement après un succès, et seulement si rien n'a
 *    bougé pendant l'aller-retour (sinon on déclarerait propre un document
 *    déjà modifié depuis) ;
 *  - un debounce de 2 s AU MOINS : chaque `saveBytes` coûte un chiffrement,
 *    une requête et une écriture versionnée ;
 *  - les rejets se lisent par CODE : `save_in_flight` n'est pas une erreur
 *    (on réessaie au prochain tour), `item_version_conflict` SUSPEND
 *    l'autosave jusqu'à un geste explicite (réessayer en boucle ne résoudrait
 *    rien : l'hôte refusera tant que l'utilisateur n'a pas tranché),
 *    `read_only` aussi ; tout autre code est montré tel quel ;
 *  - aucune sauvegarde au démontage : le port se ferme juste après
 *    `destroy()`, une promesse lancée là ne se résoudrait jamais.
 */

/** Jamais moins : en dessous, une séance de frappe devient une tempête de versions. */
export const DELAI_AUTOSAVE_MS = 2000;

export type EtatSauvegarde =
  | { type: 'propre' }
  | { type: 'modifie' }
  | { type: 'enregistrement' }
  | { type: 'enregistre'; quand: Date }
  | { type: 'conflit' }
  | { type: 'lecture_seule' }
  | { type: 'erreur'; code: string };

export interface Minuteur {
  poser(fn: () => void, ms: number): unknown;
  annuler(id: unknown): void;
}

export interface OptionsSauvegarde {
  /** Sérialise l'état COURANT et appelle `host.saveBytes`. */
  enregistrer(): Promise<void>;
  /** `host.onDirty`. */
  signalerSale(sale: boolean): void;
  surEtat(etat: EtatSauvegarde): void;
  lectureSeule: boolean;
  /**
   * Faux : cette page ne doit pas enregistrer maintenant (en co-édition, quand
   * elle n'est pas l'élue). La mutation est retenue ; `relancer()` la reprendra.
   */
  peutEnregistrer?: () => boolean;
  /** Plancher : 2 s, quoi qu'on demande. */
  delaiMs?: number;
  minuteur?: Minuteur;
}

export interface Sauvegarde {
  /** Une mutation a eu lieu. */
  modifie(): void;
  /** Un geste explicite (Ctrl+S, bouton) : lève le loquet de conflit et enregistre. */
  maintenant(): void;
  /** Les conditions ont changé (l'élu, par exemple) : repart si le document est sale. */
  relancer(): void;
  /** Annule le minuteur ; ne lance RIEN. */
  detruire(): void;
  readonly sale: boolean;
}

/**
 * Le CODE d'un rejet, lu par canard plutôt que par `instanceof Error` :
 * `instanceof` compare des prototypes et serait faux pour une erreur venue
 * d'un autre royaume — chaque rejet retomberait alors sur `save_failed`.
 */
export function codeDeRejet(e: unknown): string {
  if (typeof e === 'string' && e !== '') return e;
  if (typeof e === 'object' && e !== null) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return 'save_failed';
}

const minuteurParDefaut: Minuteur = {
  poser: (fn, ms) => setTimeout(fn, ms),
  annuler: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function creerSauvegarde(o: OptionsSauvegarde): Sauvegarde {
  const delai = Math.max(DELAI_AUTOSAVE_MS, o.delaiMs ?? DELAI_AUTOSAVE_MS);
  const m = o.minuteur ?? minuteurParDefaut;
  const autorise = () => !o.peutEnregistrer || o.peutEnregistrer();

  let minuteur: unknown = null;
  let enVol = false;
  let detruit = false;
  /** Conflit ou lecture seule découverte : plus d'autosave sans geste explicite. */
  let verrou = false;
  /** Numéro de la dernière mutation, et de la dernière enregistrée avec succès. */
  let seq = 0;
  let seqEnregistree = 0;

  const annuler = () => {
    if (minuteur !== null) m.annuler(minuteur);
    minuteur = null;
  };

  const planifier = () => {
    if (o.lectureSeule || detruit || verrou || !autorise()) return;
    annuler();
    minuteur = m.poser(() => {
      minuteur = null;
      void lancer(false);
    }, delai);
  };

  async function lancer(manuel: boolean): Promise<void> {
    if (o.lectureSeule || detruit || !autorise()) return;
    // L'hôte rejetterait `save_in_flight` : on se repose sur le tour suivant.
    if (enVol) {
      if (manuel) verrou = false;
      planifier();
      return;
    }
    if (manuel) verrou = false;
    annuler();
    const vise = seq;
    enVol = true;
    o.surEtat({ type: 'enregistrement' });
    try {
      await o.enregistrer();
      if (detruit) return;
      verrou = false;
      seqEnregistree = vise;
      if (seq === vise) {
        o.signalerSale(false);
        o.surEtat({ type: 'enregistre', quand: new Date() });
      } else {
        // Modifié pendant l'aller-retour : on reste sale, le tour suivant emporte la suite.
        o.surEtat({ type: 'modifie' });
        planifier();
      }
    } catch (e) {
      if (detruit) return;
      const code = codeDeRejet(e);
      // On RESTE sale dans tous les cas : rien n'est perdu, le modèle fait foi.
      switch (code) {
        case 'save_in_flight':
          o.surEtat({ type: 'modifie' });
          planifier();
          break;
        case 'item_version_conflict':
          verrou = true;
          o.surEtat({ type: 'conflit' });
          break;
        case 'read_only':
          verrou = true;
          o.surEtat({ type: 'lecture_seule' });
          break;
        default:
          o.surEtat({ type: 'erreur', code });
      }
    } finally {
      enVol = false;
    }
  }

  return {
    modifie() {
      if (o.lectureSeule || detruit) return;
      seq++;
      if (!autorise()) return;
      o.signalerSale(true);
      if (!verrou) o.surEtat({ type: 'modifie' });
      planifier();
    },
    maintenant() {
      void lancer(true);
    },
    relancer() {
      if (seq === seqEnregistree || !autorise() || o.lectureSeule || detruit) return;
      o.signalerSale(true);
      if (!verrou) o.surEtat({ type: 'modifie' });
      planifier();
    },
    detruire() {
      detruit = true;
      annuler();
    },
    get sale() {
      return seq !== seqEnregistree;
    },
  };
}
