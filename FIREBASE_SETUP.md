# Firebase Database Setup for DrawBattle

Current build is production-friendly for Render because it runs immediately with Node.js + Socket.IO. Profile/account data is saved in `data/profiles.json` by default.

For Firebase/Firestore setup later:

1. Go to Firebase Console.
2. Create a project named `drawbattle` or your own name.
3. Build > Firestore Database > Create database.
4. Start in test mode while developing.
5. Install Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore
```

6. Keep these included files:

```text
firebase.json
firestore.rules
firestore.indexes.json
```

7. Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules
```

Important: before public launch, make Firestore rules secure. The included rules are development/test rules only.
