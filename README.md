# HA Alert — plugin Stream Deck

Plugin Stream Deck qui permet à **Home Assistant** de déclencher des alertes visuelles sur le Stream Deck, quelle que soit la page affichée : plein écran (bascule vers un profil « Alerte » intégré) ou animation de touches choisies, avec couleurs, motifs et texte géant défilant.

> 🚧 En cours de développement. La documentation complète (installation, configuration HA, procédure des profils, exemples) arrive avec la première version.

## Développement

```bash
npm install
npm run build        # compile vers com.powange.ha-alert.sdPlugin/bin
npm test             # tests unitaires (vitest)
npm run deploy:win   # depuis WSL : copie le plugin dans Stream Deck (Windows) et le redémarre
```

## Publier une version

Pousser un tag `vX.Y.Z` : le workflow GitHub Actions construit le plugin et publie une release avec le fichier `com.powange.ha-alert.streamDeckPlugin` (double-clic pour l'installer).

```bash
git tag v0.1.0 && git push origin v0.1.0
```
