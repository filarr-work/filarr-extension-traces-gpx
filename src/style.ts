/**
 * style — tout vient du thème de Filarr (`--color-*` sur `host.container`),
 * graphique compris : le SVG lit les mêmes variables que le reste, il suit donc
 * un changement de thème sans rien recalculer.
 */

export const CSS = `
.gx {
  position: absolute; inset: 0; overflow: auto; padding: 0 0 24px;
  background: var(--color-background, Canvas); color: var(--color-text-primary, CanvasText);
  font: 14px/1.45 var(--font-family-base, system-ui, sans-serif);
}
.gx-entete {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 10px 16px;
  border-bottom: 1px solid var(--color-border, rgba(128,128,128,.35));
}
.gx-titre { margin: 0; font-size: 18px; }
.gx-fichier, .gx-note, .etat-statut { color: var(--color-text-secondary, GrayText); }
.gx-note { margin: 4px 16px 0; font-size: 12px; }
.etat-statut { margin-left: auto; }
.etat-alerte {
  margin: 8px 16px 0; padding: 8px 12px; border-radius: var(--radius-md, 6px);
  border: 1px solid var(--color-error-on-background, #b3261e); color: var(--color-error-on-background, #b3261e);
}
.gx-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 12px 16px 0; }
.gx-tuile { padding: 8px 12px; border-radius: var(--radius-md, 6px); background: var(--color-background-secondary, rgba(128,128,128,.08)); }
.gx-tuile dt { font-size: 12px; color: var(--color-text-secondary, GrayText); }
.gx-tuile dd { margin: 0; font-size: 18px; font-variant-numeric: tabular-nums; }
.gx-cadre { margin: 12px 16px 0; }
.gx-message { color: var(--color-text-secondary, GrayText); }
.gx-graphique { width: 100%; height: auto; display: block; touch-action: pan-y; }
.gx-graphique:focus-visible { outline: 2px solid var(--color-focus-ring, Highlight); outline-offset: 2px; }
.gx-grille line { stroke: var(--color-border, rgba(128,128,128,.3)); stroke-width: 1; }
.gx-grille text, .gx-limites text { fill: var(--color-text-secondary, GrayText); font-size: 12px; }
.gx-aire { fill: var(--color-primary-fill, #2563eb); fill-opacity: .18; }
.gx-ligne { fill: none; stroke: var(--color-primary-fill, #2563eb); stroke-width: 2; stroke-linejoin: round; }
.gx-limites line { stroke: var(--color-text-secondary, GrayText); stroke-dasharray: 4 4; }
.gx-repere { stroke: var(--color-text-primary, CanvasText); stroke-opacity: .5; }
.gx-point { fill: var(--color-primary-fill, #2563eb); stroke: var(--color-background, Canvas); stroke-width: 2; }
.gx-lecture { fill: var(--color-text-primary, CanvasText); font-size: 13px; font-variant-numeric: tabular-nums; }
.gx-segments { margin: 16px; border-collapse: collapse; min-width: min(640px, calc(100% - 32px)); }
.gx-segments caption { text-align: left; font-weight: 600; padding-bottom: 6px; }
.gx-segments th, .gx-segments td { text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--color-border, rgba(128,128,128,.25)); font-variant-numeric: tabular-nums; }
.gx-nom {
  font: inherit; width: 100%; min-width: 180px; padding: 4px 6px; color: inherit;
  background: var(--color-surface, Field); border: 1px solid var(--color-border, rgba(128,128,128,.5)); border-radius: var(--radius-sm, 4px);
}
.gx-nom:focus-visible { outline: 2px solid var(--color-focus-ring, Highlight); outline-offset: 1px; }
.gx-nom[readonly] { background: transparent; border-color: transparent; }
`;
