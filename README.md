# CRALK – Lecteur de musique PWA

Ce dépôt contient une application Progressive Web App (PWA) simple nommée **CRALK** qui permet de charger un fichier audio local et de le lire directement sur votre iPhone (ou tout autre appareil). En attendant la future intégration de Spotify, cette version sert de lecteur autonome pour vos fichiers.

## Fonctionnalités principales

- **Sélection de fichier audio** : un bouton « Choisir un fichier audio » ouvre l’explorateur de fichiers. Tous les formats audio standard pris en charge par Safari (MP3, M4A, WAV, etc.) peuvent être sélectionnés.
- **Lecture audio intégrée** : le fichier est chargé dans un lecteur HTML5 avec commande lecture/pause et barre de progression.
- **Accès caméra et micro** : un bouton **« Activer caméra et micro »** demande l’autorisation d’utiliser la caméra frontale et le microphone de l’appareil. Un aperçu vidéo en direct s’affiche lorsque l’autorisation est accordée.
- **Enregistrement synchronisé** : après avoir sélectionné un morceau et activé les médias, le bouton **« Commencer l’enregistrement »** démarre la lecture du fichier audio, combine ce flux avec celui du microphone et enregistre la vidéo de la caméra. Le bouton **« Arrêter l’enregistrement »** termine la capture et génère un fichier vidéo WebM que vous pouvez regarder et télécharger.
- **Application installable** : grâce au manifeste et au service worker, vous pouvez ajouter CRALK à l’écran d’accueil de votre iPhone comme une application native (nécessite iOS 14 ou supérieur). La mise en cache permet d’utiliser l’interface hors ligne après l’installation.

## Installation et utilisation

1. **Hébergement du site** : Pour que le service worker fonctionne et que l’application soit installable, les fichiers doivent être servis depuis une URL sécurisée (HTTPS). Vous pouvez par exemple :
   - Héberger le dossier `cralk_pwa` sur GitHub Pages, Vercel, Netlify ou un serveur personnel avec HTTPS.
   - Tester localement en lançant un serveur HTTP : exécutez `python3 -m http.server 8000` dans le dossier `cralk_pwa` puis ouvrez `http://localhost:8000` dans votre navigateur.
2. **Installation sur iPhone** :
   - Ouvrez l’URL du site CRALK dans Safari.
   - Appuyez sur le bouton de partage (icône avec le carré et une flèche vers le haut) et choisissez **« Ajouter à l’écran d’accueil »**. L’app apparaîtra alors comme une application autonome.
3. **Utilisation** :
   - Lancez l’application CRALK depuis votre écran d’accueil.
   - Appuyez sur **« Choisir un fichier audio »**, sélectionnez un fichier dans l’app Fichiers de votre iPhone. Le nom du fichier et sa taille s’affichent, puis la lecture commence.
   - Utilisez les commandes du lecteur pour mettre en pause, avancer ou reculer.
   - Appuyez sur **« Activer caméra et micro »**. Safari vous demandera l’autorisation d’accéder à la caméra et au microphone : acceptez pour afficher un aperçu vidéo.
   - Lorsque vous êtes prêt, cliquez sur **« Commencer l’enregistrement »**. La chanson est lue depuis le début et l’application enregistre la vidéo synchronisée avec la bande‑son (et votre voix si vous parlez/chantez). Le bouton **« Arrêter l’enregistrement »** met fin à la capture.
   - Après l’arrêt, un lecteur apparaît dans l’interface pour prévisualiser le résultat et un lien **Télécharger la vidéo** permet de récupérer le fichier `.webm`.

## Structure des fichiers

- `index.html` : page principale définissant l’interface utilisateur.
- `styles.css` : feuilles de styles pour la mise en page et les couleurs.
- `main.js` : logique de sélection et de lecture des fichiers audio et enregistrement du service worker.
- `manifest.json` : manifeste décrivant le nom, les icônes et les couleurs de l’application pour l’installation en PWA.
- `sw.js` : service worker qui met en cache les ressources nécessaires pour une utilisation hors ligne.
- `icon-192.png` & `icon-512.png` : icônes utilisées pour l’écran d’accueil et le manifeste.

## Limites

- Cette version ne contient pas encore d’intégration Spotify. Elle permet uniquement de charger des fichiers audio locaux.
- Les navigateurs mobiles imposent certaines restrictions (par exemple, l’audio ne se lance qu’après une action de l’utilisateur).
- L’app n’accède qu’au fichier sélectionné ; elle ne parcourt pas automatiquement votre bibliothèque musicale.

## À propos de la version iOS native

Pour obtenir une application iOS native à installer via TestFlight ou sur l’App Store, il est nécessaire d’utiliser Xcode sur un Mac et un compte développeur Apple. Cette PWA fonctionne sur iOS 14+ sans passer par l’App Store. Une base de projet iOS en SwiftUI avec import de fichiers (`UIDocumentPickerViewController`) peut être fournie séparément, mais nécessitera une compilation et signature de votre part.