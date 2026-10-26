import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELAI_AUTOSAVE_MS, codeDeRejet, creerSauvegarde, type EtatSauvegarde } from '../sauvegarde';

/** Un banc : un faux `saveBytes` pilotable, et tout ce que la sauvegarde dit. */
function banc(o: { lectureSeule?: boolean; peutEnregistrer?: () => boolean } = {}) {
  const sales: boolean[] = [];
  const etats: EtatSauvegarde['type'][] = [];
  const reponses: (string | null)[] = [];
  let appels = 0;
  const s = creerSauvegarde({
    lectureSeule: o.lectureSeule ?? false,
    peutEnregistrer: o.peutEnregistrer,
    enregistrer: () => {
      appels++;
      const code = reponses.shift() ?? null;
      return code ? Promise.reject(new Error(code)) : Promise.resolve();
    },
    signalerSale: (d) => sales.push(d),
    surEtat: (e) => etats.push(e.type),
  });
  return { s, sales, etats, reponses, appels: () => appels };
}

const tour = () => vi.advanceTimersByTimeAsync(0);

describe('sauvegarde', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('annonce la saleté à CHAQUE mutation et attend 2 s', async () => {
    const b = banc();
    b.s.modifie();
    b.s.modifie();
    expect(b.sales).toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS - 1);
    expect(b.appels()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.appels()).toBe(1);
    expect(b.sales.at(-1)).toBe(false);
    expect(b.etats.at(-1)).toBe('enregistre');
    expect(b.s.sale).toBe(false);
  });

  it('ne descend jamais sous 2 s, même si on le demande', async () => {
    const appels: number[] = [];
    const s = creerSauvegarde({
      lectureSeule: false,
      delaiMs: 100,
      enregistrer: async () => {
        appels.push(Date.now());
      },
      signalerSale: () => undefined,
      surEtat: () => undefined,
    });
    s.modifie();
    await vi.advanceTimersByTimeAsync(1999);
    expect(appels).toHaveLength(0);
  });

  it("reste sale si l'on modifie pendant l'aller-retour", async () => {
    const b = banc();
    let finir: () => void = () => undefined;
    const s = creerSauvegarde({
      lectureSeule: false,
      enregistrer: () => new Promise<void>((r) => (finir = r)),
      signalerSale: (d) => b.sales.push(d),
      surEtat: () => undefined,
    });
    s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    s.modifie();
    finir();
    await tour();
    expect(b.sales).not.toContain(false);
    expect(s.sale).toBe(true);
  });

  it('save_in_flight : rien d’alarmant, on réessaie au tour suivant', async () => {
    const b = banc();
    b.reponses.push('save_in_flight');
    b.s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(b.etats.at(-1)).toBe('modifie');
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(b.appels()).toBe(2);
    expect(b.sales.at(-1)).toBe(false);
  });

  it('item_version_conflict : loquet jusqu’au geste explicite', async () => {
    const b = banc();
    b.reponses.push('item_version_conflict');
    b.s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(b.etats.at(-1)).toBe('conflit');
    b.s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS * 3);
    expect(b.appels()).toBe(1);
    expect(b.sales.at(-1)).toBe(true);
    b.s.maintenant();
    await tour();
    expect(b.appels()).toBe(2);
    expect(b.etats.at(-1)).toBe('enregistre');
  });

  it('read_only et codes inconnus : on reste sale, le code est transmis', async () => {
    const b = banc();
    const codes: string[] = [];
    const s = creerSauvegarde({
      lectureSeule: false,
      enregistrer: () => Promise.reject(new Error('quota_exceeded')),
      signalerSale: () => undefined,
      surEtat: (e) => {
        if (e.type === 'erreur') codes.push(e.code);
      },
    });
    s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(codes).toEqual(['quota_exceeded']);
    expect(s.sale).toBe(true);

    b.reponses.push('read_only');
    b.s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(b.etats.at(-1)).toBe('lecture_seule');
  });

  it('lecture seule : ni saleté, ni sauvegarde', async () => {
    const b = banc({ lectureSeule: true });
    b.s.modifie();
    b.s.maintenant();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS * 2);
    expect(b.appels()).toBe(0);
    expect(b.sales).toEqual([]);
  });

  it('pas l’élu : la mutation est retenue, reprise par relancer()', async () => {
    let elu = false;
    const b = banc({ peutEnregistrer: () => elu });
    b.s.modifie();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(b.appels()).toBe(0);
    expect(b.sales).toEqual([]);
    elu = true;
    b.s.relancer();
    expect(b.sales).toEqual([true]);
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS);
    expect(b.appels()).toBe(1);
  });

  it('detruire() annule le minuteur et ne lance rien', async () => {
    const b = banc();
    b.s.modifie();
    b.s.detruire();
    await vi.advanceTimersByTimeAsync(DELAI_AUTOSAVE_MS * 2);
    expect(b.appels()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lit le code par canard', () => {
    expect(codeDeRejet(new Error('read_only'))).toBe('read_only');
    expect(codeDeRejet({ message: 'item_version_conflict' })).toBe('item_version_conflict');
    expect(codeDeRejet('busy')).toBe('busy');
    expect(codeDeRejet(undefined)).toBe('save_failed');
  });
});
