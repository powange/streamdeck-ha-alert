# HA Alert — plugin Stream Deck

Plugin Stream Deck qui permet à **Home Assistant** de déclencher des alertes visuelles sur le Stream Deck, quelle que soit la page affichée : plein écran (bascule vers un profil « Alerte » intégré) ou animation de touches choisies, avec couleurs, motifs et texte géant défilant.

> 🚧 En cours de développement. La documentation complète (installation, configuration HA, exemples) arrive avec la première version.

## Profils « Alerte »

Un plugin Stream Deck ne peut dessiner que sur ses propres touches. Pour couvrir n'importe quelle page, le mode `fullscreen` bascule l'appareil vers un profil « Alerte » livré avec le plugin et entièrement rempli d'**Alert keys**, puis revient au profil précédent (sur la page qui était affichée).

Ce profil dépend du modèle de Stream Deck et doit être créé à la main dans le logiciel Stream Deck, sur un appareil du bon modèle, puis exporté.

| Appareil | `DeviceType` | Fichier attendu | Disponible |
|---|---|---|---|
| Stream Deck XL (8×4) | 2 | `profiles/HA Alert XL.streamDeckProfile` | à créer |
| Stream Deck MK.2 / Original (5×3) | 0 | `profiles/HA Alert.streamDeckProfile` | non |
| Stream Deck Mini (3×2) | 1 | `profiles/HA Alert Mini.streamDeckProfile` | non |
| Stream Deck + (4×2) | 7 | `profiles/HA Alert Plus.streamDeckProfile` | non |
| Stream Deck Neo (4×2) | 9 | `profiles/HA Alert Neo.streamDeckProfile` | non |

Sans profil pour un appareil, une alerte `fullscreen` s'affiche seulement sur les Alert keys de la page visible, comme en mode `keys`.

### Créer et exporter un profil

1. **Créer le profil.** Dans le logiciel Stream Deck, sélectionne l'appareil, ouvre la liste des profils (en haut) → **Modifier les profils…** → **+**. Nomme-le par exemple « HA Alert ».
2. **Remplir toutes les touches.** Dans la liste des actions, catégorie **HA Alert**, glisse **Alert key** sur la première touche. Pour les autres : clic droit sur la touche → **Copier**, puis clic droit sur chaque touche vide → **Coller** (ou Ctrl+C / Ctrl+V). Toutes les touches doivent être des Alert keys :
   - pas d'autre action, pas de dossier, une seule page ;
   - pour un Stream Deck +, laisse les molettes et l'écran tactile vides.

   Les réglages d'apparence des touches n'ont pas d'importance : pendant une alerte, le plugin les redessine.
3. **Exporter.** Toujours dans **Modifier les profils…**, sélectionne le profil → menu **⋯** (ou roue dentée) → **Exporter**. Enregistre le fichier sous le nom indiqué dans le tableau, par exemple `HA Alert XL.streamDeckProfile`.
4. **Ajouter au plugin.** Copie le fichier dans `com.powange.ha-alert.sdPlugin/profiles/`, puis déclare-le dans `manifest.json` :

   ```json
   "Profiles": [
       { "Name": "profiles/HA Alert XL", "DeviceType": 2, "Readonly": false, "DontAutoSwitchWhenInstalled": true }
   ]
   ```

5. **Supprimer le profil d'origine** (facultatif). Une fois le plugin réinstallé, le logiciel propose d'installer le profil fourni par le plugin ; c'est celui-là que le plugin utilise, l'original créé à la main ne sert plus.

Astuce : si l'appareil reste affiché sur le profil Alerte sans alerte en cours (après un redémarrage, par exemple), un appui sur n'importe quelle touche ramène au profil précédent.

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
