# HA Alert — plugin Stream Deck

Plugin Stream Deck qui permet à **Home Assistant** d'afficher des alertes visuelles sur le Stream Deck, quelle que soit la page affichée :

- **plein écran** : le Stream Deck bascule sur un profil « Alerte », affiche l'alerte sur toutes ses touches (texte géant, couleurs, animation), puis revient sur la page où tu étais ;
- **touches choisies** : seules certaines touches de ta page s'animent, sans changer de page.

Un appui sur le Stream Deck acquitte l'alerte, et Home Assistant peut en être prévenu.

## Sommaire

1. [Installer le plugin](#1-installer-le-plugin)
2. [Créer un token dans Home Assistant](#2-créer-un-token-dans-home-assistant)
3. [Connecter le plugin à Home Assistant](#3-connecter-le-plugin-à-home-assistant)
4. [Envoyer une première alerte](#4-envoyer-une-première-alerte)
5. [Installer les scripts Home Assistant](#5-installer-les-scripts-home-assistant)
6. [Déclencher des alertes depuis une automatisation](#6-déclencher-des-alertes-depuis-une-automatisation)
7. [Référence des champs](#7-référence-des-champs)
8. [Plein écran ou touches choisies](#8-plein-écran-ou-touches-choisies)
9. [Plusieurs alertes en même temps](#9-plusieurs-alertes-en-même-temps)
10. [Réagir à l'acquittement](#10-réagir-à-lacquittement)
11. [Dépannage](#11-dépannage)
12. [Profils « Alerte »](#profils--alerte-)
13. [Développement](#développement)

## 1. Installer le plugin

1. Télécharge le fichier `com.powange.ha-alert.streamDeckPlugin` de la [dernière version](https://github.com/powange/streamdeck-ha-alert/releases/latest).
2. Double-clique dessus : le logiciel Stream Deck (version 7.1 ou plus, Windows) installe le plugin.
3. Si le logiciel propose d'installer le profil **HA Alert**, accepte : c'est le profil utilisé pour les alertes en plein écran. Il est disponible pour le Stream Deck XL (voir [Profils « Alerte »](#profils--alerte-) pour les autres modèles).

Le plugin ajoute une catégorie **HA Alert** avec deux actions :

| Action | Rôle |
|---|---|
| **Statut HA** | Configure la connexion à Home Assistant et affiche son état. |
| **Alert key** | Touche qui s'anime pendant une alerte. Hors alerte, elle prend l'apparence réglée dans son inspecteur (fond, texte, icône). |

## 2. Créer un token dans Home Assistant

Le plugin se connecte à Home Assistant avec un **jeton d'accès longue durée**.

1. Dans Home Assistant, clique sur ton **profil** (en bas à gauche) → onglet **Sécurité**.
2. Section **Jetons d'accès longue durée** → **Créer un jeton** → nomme-le « Stream Deck ».
3. Copie le jeton : il n'est affiché qu'une seule fois.

> ⚠️ Le compte doit être **administrateur**. Home Assistant réserve aux administrateurs l'écoute des événements personnalisés (comme `streamdeck_alert`) et l'envoi d'événements (comme l'acquittement).

## 3. Connecter le plugin à Home Assistant

1. Glisse l'action **Statut HA** sur une touche du Stream Deck.
2. Dans son inspecteur (en bas de la fenêtre du logiciel Stream Deck) :
   - **URL** : l'adresse de ton Home Assistant, par exemple `http://homeassistant.local:8123` ou `https://ha.mondomaine.fr`. Elle est convertie automatiquement en adresse WebSocket (`ws(s)://…/api/websocket`).
   - **Token** : le jeton créé à l'étape précédente.
3. Clique sur **Tester la connexion** : le message « ✔ Connecté à Home Assistant … » doit s'afficher.

La touche **Statut HA** affiche en permanence l'état de la connexion :

| Pastille | Signification |
|---|---|
| 🟢 Connecté | Tout va bien. |
| 🟡 Connexion… | Connexion en cours. |
| 🟠 Hors ligne | Home Assistant injoignable ; le plugin réessaie tout seul (de 1 s à 60 s entre deux essais). |
| 🔴 Token refusé | Le jeton est invalide ou a été supprimé. |
| 🔴 Pas admin | Le compte du jeton n'est pas administrateur. |
| ⚪ À configurer | URL ou token manquant. |

## 4. Envoyer une première alerte

Sans rien installer d'autre dans Home Assistant :

1. Va dans **Outils de développement** → onglet **Événements**.
2. Dans **Déclencher un événement**, saisis le type `streamdeck_alert`.
3. Dans **Données de l'événement**, colle :

   ```yaml
   id: test
   text: Bonjour
   ```

4. Clique sur **Déclencher l'événement**.

Le Stream Deck bascule sur le profil Alerte, et « Bonjour » clignote en rouge, en très gros, sur toutes les touches. Appuie sur une touche pour fermer l'alerte : tu reviens sur ta page. Sans appui, l'alerte disparaît d'elle-même au bout de 30 secondes.

Pour effacer une alerte depuis Home Assistant, déclenche `streamdeck_alert_clear` avec `id: test` (ou sans données pour tout effacer).

## 5. Installer les scripts Home Assistant

Le dossier [`homeassistant/`](homeassistant/) contient deux scripts qui rendent les alertes plus simples à utiliser : un formulaire avec des sélecteurs (couleur, motif, icône…) au lieu d'écrire l'événement à la main.

| Script | Rôle |
|---|---|
| `script.streamdeck_alert` | Affiche une alerte. |
| `script.streamdeck_alert_clear` | Efface une alerte, ou toutes. |

**Installation :**

- **Avec le fichier `scripts.yaml`** : copie le contenu de [`homeassistant/scripts.yaml`](homeassistant/scripts.yaml) à la fin du fichier `scripts.yaml` de ta configuration, puis **Outils de développement** → **YAML** → **Recharger les scripts**.
- **Depuis l'interface** : **Paramètres** → **Automatisations et scènes** → **Scripts** → **Créer un script** → menu **⋮** → **Modifier en YAML**. Colle le contenu du script `streamdeck_alert` (tout ce qui est sous la ligne `streamdeck_alert:`, sans cette ligne), puis enregistre avec l'identifiant `streamdeck_alert`. Fais de même pour `streamdeck_alert_clear`.

**Essai :** **Outils de développement** → **Actions** → `script.streamdeck_alert`. Le formulaire liste tous les champs ; seuls l'identifiant et, en général, le texte sont nécessaires.

## 6. Déclencher des alertes depuis une automatisation

Dans une automatisation, ajoute l'action **Script : Alerte Stream Deck**, ou en YAML :

```yaml
actions:
  - action: script.streamdeck_alert
    data:
      id: sonnette
      text: Sonnette
      color: [255, 0, 0]
      ack_required: true
      duration_s: 120
```

Exemples complets, prêts à adapter (remplace les entités par les tiennes) :

| Fichier | Exemple |
|---|---|
| [`automations/sonnette.yaml`](homeassistant/automations/sonnette.yaml) | Sonnette : plein écran rouge clignotant, à acquitter ; effacé quand la porte s'ouvre. |
| [`automations/lave-linge.yaml`](homeassistant/automations/lave-linge.yaml) | Lave-linge terminé : une seule touche pulse en vert pendant 60 s, sans changer de page. |
| [`automations/acquittement.yaml`](homeassistant/automations/acquittement.yaml) | Notification sur le téléphone quand la sonnette a été vue sur le Stream Deck, ou quand personne n'a répondu. |

Les données peuvent venir de templates, par exemple :

```yaml
text: "{{ states('sensor.temperature_congelateur') }} °C au congélateur !"
```

**Avec Assist :** expose le script `script.streamdeck_alert` à Assist (**Paramètres** → **Assistants vocaux** → **Exposer**) pour qu'un agent conversationnel puisse afficher un message sur le Stream Deck (« affiche "À table !" sur le Stream Deck »).

## 7. Référence des champs

Événement `streamdeck_alert` (et champs du script `script.streamdeck_alert`). Seul `id` est obligatoire.

| Champ | Valeurs | Défaut | Rôle |
|---|---|---|---|
| `id` | texte | — | Identifiant unique. Une alerte avec le même `id` remplace la précédente. |
| `text` | texte (200 caractères max.) | vide | Texte affiché. Un retour à la ligne (ou `\n`) force une nouvelle ligne. |
| `mode` | `fullscreen`, `keys` | `fullscreen` | Plein écran ou touches choisies ([détails](#8-plein-écran-ou-touches-choisies)). |
| `pattern` | `blink`, `pulse`, `chase`, `solid`, `rainbow` | `blink` | Clignotement, pulsation, chenillard, fixe ou arc-en-ciel. |
| `color` | `#rrggbb`, `#rgb` ou `[r, g, b]` | `#ff0000` | Couleur principale. |
| `color2` | idem | `#000000` | Seconde couleur du clignotement, de la pulsation et du chenillard. |
| `keys` | liste d'index : `[0, 4, 10]` ou `"0, 4, 10"` | toutes | Touches concernées ([index](#index-des-touches)). |
| `key_colors` | `{"0": "#ff0000", "4": "#00ff00"}` | aucune | Couleur principale propre à certaines touches. |
| `text_style` | `banner`, `key` | `banner` en plein écran, `key` sinon | Texte géant sur tout le Stream Deck, ou répété sur chaque touche. |
| `icon` | `none`, `bell`, `door`, `warning`, `info`, `check`, `washer` | `none` | Icône affichée au-dessus du texte (style `key` uniquement). |
| `interval_ms` | 100 à 10 000 | 500 | Durée d'une étape de l'animation, en millisecondes. |
| `duration_s` | 0 à 86 400 | 30 | Durée d'affichage sans acquittement, en secondes. `0` : jusqu'à l'acquittement ou un effacement. |
| `priority` | -1000 à 1000 | 0 | La plus prioritaire s'affiche en premier. |
| `ack_required` | `true`, `false` | `false` | Envoie `streamdeck_alert_ack` à Home Assistant lors d'un appui. |

**Texte géant (`banner`) :** un texte court s'affiche en très gros sur toute la hauteur ; un texte plus long est réparti en lignes, une par rangée de touches ; un texte trop long défile. Les espaces entre les touches coupent un peu les lettres, comme sur un panneau lumineux.

Événement `streamdeck_alert_clear` : `id` pour effacer une alerte, rien pour tout effacer.

## 8. Plein écran ou touches choisies

### Plein écran (`mode: fullscreen`)

Chaque Stream Deck qui dispose d'un profil Alerte bascule dessus, affiche l'alerte sur toutes ses touches, puis revient sur la page d'origine quand l'alerte se termine (appui, fin de durée ou effacement). Avec plusieurs Stream Deck, tous basculent, et un appui sur l'un d'eux les libère tous.

Si tu quittes toi-même le profil Alerte pendant une alerte, le plugin ne t'y ramène pas, et ne fait pas de retour automatique à la fin.

### Touches choisies (`mode: keys`)

Pose des **Alert keys** sur tes pages habituelles : pendant une alerte, celles dont l'index figure dans `keys` s'animent (toutes si `keys` est vide), les autres gardent leur apparence. La page ne change pas. Un appui sur une Alert key acquitte l'alerte.

### Index des touches

Les touches sont numérotées à partir de 0, de gauche à droite puis de haut en bas : index = ligne × nombre de colonnes + colonne.

```
Stream Deck MK.2 (5×3)          Stream Deck XL (8×4)
 0  1  2  3  4                   0  1  2  3  4  5  6  7
 5  6  7  8  9                   8  9 10 11 12 13 14 15
10 11 12 13 14                  16 17 18 19 20 21 22 23
                                24 25 26 27 28 29 30 31
```

## 9. Plusieurs alertes en même temps

Les alertes actives forment une file : la plus prioritaire s'affiche (à priorité égale, la plus récente). Quand elle se termine, la suivante prend sa place.

En plein écran, dès qu'au moins deux alertes attendent :

- un badge **1/3** en haut à droite indique la position dans la file ;
- sur la dernière rangée, **◀** et **▶** (en bas à gauche) parcourent la file sans acquitter, et **✖✖** (en bas à droite) acquitte tout ;
- n'importe quelle autre touche acquitte l'alerte affichée.

## 10. Réagir à l'acquittement

Le plugin envoie deux événements à Home Assistant :

| Événement | Quand | Données |
|---|---|---|
| `streamdeck_alert_ack` | Appui sur le Stream Deck, si l'alerte a `ack_required: true` | `id`, `device` (nom du Stream Deck), `device_id` |
| `streamdeck_alert_expired` | Fin de `duration_s` sans appui | `id` |

Exemple de déclencheur :

```yaml
triggers:
  - trigger: event
    event_type: streamdeck_alert_ack
    event_data:
      id: sonnette
```

Voir [`automations/acquittement.yaml`](homeassistant/automations/acquittement.yaml).

## 11. Dépannage

| Problème | Solution |
|---|---|
| « Token refusé » | Recrée un jeton (étape 2) et colle-le à nouveau. |
| « Pas admin » | Crée le jeton depuis un compte administrateur. |
| « Hors ligne » | Vérifie l'URL (ouvre-la dans un navigateur) ; le plugin se reconnecte tout seul dès que Home Assistant répond. |
| Rien ne s'affiche en plein écran | Ton modèle de Stream Deck n'a peut-être pas encore de profil Alerte (voir ci-dessous) : l'alerte s'affiche alors seulement sur les Alert keys de la page visible. |
| Rien ne s'affiche en mode `keys` | Il faut des Alert keys sur la page affichée, aux index indiqués dans `keys`. |
| Alerte ignorée | Les données sont invalides (couleur mal écrite, motif inconnu…) : le détail est dans le journal du plugin, `%APPDATA%\Elgato\StreamDeck\Plugins\com.powange.ha-alert.sdPlugin\logs\`. |
| Le Stream Deck reste sur le profil Alerte | Appuie sur n'importe quelle touche : sans alerte en cours, cela ramène au profil précédent. |

## Profils « Alerte »

Un plugin Stream Deck ne peut dessiner que sur ses propres touches. Pour couvrir n'importe quelle page, le mode `fullscreen` bascule l'appareil vers un profil « Alerte » livré avec le plugin et entièrement rempli d'**Alert keys**, puis revient au profil précédent (sur la page qui était affichée).

Ce profil dépend du modèle de Stream Deck et doit être créé à la main dans le logiciel Stream Deck, sur un appareil du bon modèle, puis exporté.

| Appareil | `DeviceType` | Fichier attendu | Disponible |
|---|---|---|---|
| Stream Deck XL (8×4) | 2 | `profiles/HA Alert XL.streamDeckProfile` | oui |
| Stream Deck MK.2 / Original (5×3) | 0 | `profiles/HA Alert.streamDeckProfile` | non |
| Stream Deck Mini (3×2) | 1 | `profiles/HA Alert Mini.streamDeckProfile` | non |
| Stream Deck + (4×2) | 7 | `profiles/HA Alert Plus.streamDeckProfile` | non |
| Stream Deck Neo (4×2) | 9 | `profiles/HA Alert Neo.streamDeckProfile` | non |

Sans profil pour un appareil, une alerte `fullscreen` s'affiche seulement sur les Alert keys de la page visible, comme en mode `keys`. Tu as un de ces modèles ? Crée le profil avec la procédure ci-dessous et propose-le dans une pull request.

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

5. **Supprimer le profil d'origine.** Une fois le plugin réinstallé, le logiciel installe le profil fourni par le plugin, sous le nom « HA Alert copie » si « HA Alert » existe déjà. C'est celui-là que le plugin utilise : supprime l'original créé à la main, puis renomme la copie si tu veux.

## Développement

```bash
npm install
npm run build        # compile vers com.powange.ha-alert.sdPlugin/bin
npm test             # tests unitaires (vitest)
npm run deploy:win   # depuis WSL : copie le plugin dans Stream Deck (Windows) et le redémarre
```

### Publier une version

Pousser un tag `vX.Y.Z` : le workflow GitHub Actions construit le plugin et publie une release avec le fichier `com.powange.ha-alert.streamDeckPlugin` (double-clic pour l'installer).

```bash
git tag v0.3.0 && git push origin v0.3.0
```
