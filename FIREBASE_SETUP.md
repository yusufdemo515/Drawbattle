# DrawBattle Firebase Setup

This build includes Google Login + Firestore profile sync.

## Firebase Console steps

1. Go to Firebase Console → Project `drawbattle-buddhu`.
2. Authentication → Sign-in method → enable **Google**.
3. Authentication → Settings → Authorized domains → add your Render domain:
   - `drawbattle-uyje.onrender.com`
   - also keep `localhost` for local testing.
4. Firestore Database → Create database.
5. Firestore Database → Rules → paste `firestore.rules` from this project → Publish.

## What is saved in Firestore

`users/{uid}` saves private player data:
- username
- avatarId / bannerId / decoId
- coins
- XP / level
- wins / matches
- owned cosmetics

`publicProfiles/{uid}` saves public profile card data only:
- username
- avatar/banner/decoration
- level, XP, wins, matches

Coins and inventory are not stored in public profile docs.

## Current AI Detector Status

AI drawing detector is intentionally OFF for now.
Current safety is manual report + host review blur.
Real prompt-match AI and automatic adult/illegal image detection can be added later with a Vision API key.
