// DrawBattle Firebase Auth + Firestore client connector.
// Uses Firebase Web SDK compat CDN loaded in index.html.
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyC7wrertXDqUiV_W1hOy6atfZzvLreZvlw",
    authDomain: "drawbattle-buddhu.firebaseapp.com",
    projectId: "drawbattle-buddhu",
    storageBucket: "drawbattle-buddhu.firebasestorage.app",
    messagingSenderId: "517233102086",
    appId: "1:517233102086:web:9478b4cb93904334e9e287",
    measurementId: "G-32TEGS7B5X"
  };

  const ready = { enabled: false, user: null, auth: null, db: null };
  window.drawBattleFirebase = ready;

  function safeCall(name, ...args) {
    if (typeof window[name] === "function") {
      try { window[name](...args); } catch (e) { console.warn(name + " failed", e); }
    }
  }

  function setUi(user) {
    const authStatus = document.getElementById("authStatus");
    const authHint = document.getElementById("authHint");
    const loginBtn = document.getElementById("googleLoginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const panel = document.getElementById("authPanel");
    if (!authStatus) return;
    if (user) {
      authStatus.textContent = "✅ Logged in: " + (user.displayName || user.email || "Google user");
      authHint.textContent = "Your profile, coins, XP, inventory and equipped cosmetics are syncing with Firebase.";
      if (loginBtn) loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "inline-block";
      if (panel) { panel.classList.remove("auth-warn"); panel.classList.add("auth-ok"); }
    } else {
      authStatus.textContent = "Guest mode";
      authHint.textContent = "Login with Google to save profile, coins, XP, inventory and equipped cosmetics in Firebase.";
      if (loginBtn) loginBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (panel) { panel.classList.remove("auth-ok"); panel.classList.add("auth-warn"); }
    }
  }

  async function ensureCloudProfile(user, localProfile) {
    const db = ready.db;
    const userRef = db.collection("users").doc(user.uid);
    const publicRef = db.collection("publicProfiles").doc(user.uid);
    const snap = await userRef.get();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const freeOwned = [
      ...((window.COSMETICS && window.COSMETICS.freeAvatarIds) || []),
      ...((window.COSMETICS && window.COSMETICS.freeBannerIds) || [])
    ];
    const base = Object.assign({}, localProfile || {}, snap.exists ? snap.data() : {});
    const profile = {
      uid: user.uid,
      profileId: "fb_" + user.uid,
      username: base.username || localStorage.getItem("drawbattleUsername") || "",
      usernameNormalized: base.usernameNormalized || "",
      setupComplete: !!base.setupComplete,
      usernameSetAt: Number(base.usernameSetAt || 0),
      lastUsernameChangeAt: Number(base.lastUsernameChangeAt || 0),
      photoURL: user.photoURL || "",
      coins: Number(base.coins || 0),
      xp: Number(base.xp || 0),
      level: Math.max(1, Math.floor(Number(base.xp || 0) / 250) + 1),
      wins: Number(base.wins || 0),
      matches: Number(base.matches || 0),
      daily: base.daily || { lastClaim: 0, streak: 0 },
      badges: Array.isArray(base.badges) ? base.badges : [],
      friends: Array.isArray(base.friends) ? base.friends : [],
      friendRequestsIn: Array.isArray(base.friendRequestsIn) ? base.friendRequestsIn : [],
      friendRequestsOut: Array.isArray(base.friendRequestsOut) ? base.friendRequestsOut : [],
      owned: Array.from(new Set([...(base.owned || []), ...freeOwned])),
      avatarId: base.avatarId || window.COSMETICS?.freeAvatarIds?.[0] || "free_purple_glasses",
      bannerId: base.bannerId || window.COSMETICS?.freeBannerIds?.[0] || "banner_free_pink",
      decoId: base.decoId || "",
      updatedAt: now,
      createdAt: base.createdAt || now
    };
    await userRef.set(profile, { merge: true });
    await publicRef.set({
      uid: user.uid,
      profileId: profile.profileId,
      username: profile.username || "",
      setupComplete: !!profile.setupComplete,
      avatarId: profile.avatarId,
      bannerId: profile.bannerId,
      decoId: profile.decoId,
      level: profile.level,
      xp: profile.xp,
      wins: profile.wins,
      matches: profile.matches,
      badges: Array.isArray(profile.badges) ? profile.badges : [],
      updatedAt: now
    }, { merge: true });
    return profile;
  }

  async function saveProfile(profile) {
    if (!ready.enabled || !ready.user || !profile) return false;
    const user = ready.user;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const safe = {
      uid: user.uid,
      profileId: "fb_" + user.uid,
      username: profile.username || "",
      usernameNormalized: profile.usernameNormalized || "",
      setupComplete: !!profile.setupComplete,
      usernameSetAt: Number(profile.usernameSetAt || 0),
      lastUsernameChangeAt: Number(profile.lastUsernameChangeAt || 0),
      coins: Number(profile.coins || 0),
      xp: Number(profile.xp || 0),
      level: Math.max(1, Math.floor(Number(profile.xp || 0) / 250) + 1),
      wins: Number(profile.wins || 0),
      matches: Number(profile.matches || 0),
      daily: profile.daily || { lastClaim: 0, streak: 0 },
      badges: Array.isArray(profile.badges) ? profile.badges : [],
      friends: Array.isArray(profile.friends) ? profile.friends : [],
      friendRequestsIn: Array.isArray(profile.friendRequestsIn) ? profile.friendRequestsIn : [],
      friendRequestsOut: Array.isArray(profile.friendRequestsOut) ? profile.friendRequestsOut : [],
      owned: Array.isArray(profile.owned) ? profile.owned : [],
      avatarId: profile.avatarId || "",
      bannerId: profile.bannerId || "",
      decoId: profile.decoId || "",
      updatedAt: now
    };
    await ready.db.collection("users").doc(user.uid).set(safe, { merge: true });
    await ready.db.collection("publicProfiles").doc(user.uid).set({
      uid: user.uid,
      profileId: safe.profileId,
      username: safe.username || "",
      setupComplete: !!safe.setupComplete,
      avatarId: safe.avatarId,
      bannerId: safe.bannerId,
      decoId: safe.decoId,
      level: safe.level,
      xp: safe.xp,
      wins: safe.wins,
      matches: safe.matches,
      badges: Array.isArray(safe.badges) ? safe.badges : [],
      updatedAt: now
    }, { merge: true });
    return true;
  }

  window.firebaseGoogleLogin = async function () {
    if (!ready.enabled) return alert("Firebase not loaded. Check internet / Firebase setup.");
    const provider = new firebase.auth.GoogleAuthProvider();
    await ready.auth.signInWithPopup(provider);
  };

  window.firebaseLogout = async function () {
    if (!ready.enabled) return;
    await ready.auth.signOut();
  };

  window.drawBattleFirebase.saveProfile = saveProfile;
  window.drawBattleFirebase.ensureCloudProfile = ensureCloudProfile;

  window.addEventListener("DOMContentLoaded", function () {
    try {
      if (!window.firebase) throw new Error("Firebase SDK missing");
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      try { firebase.analytics && firebase.analytics(); } catch (_) {}
      ready.enabled = true;
      ready.auth = firebase.auth();
      ready.db = firebase.firestore();
      ready.auth.onAuthStateChanged(async function (user) {
        ready.user = user || null;
        setUi(user);
        safeCall("handleFirebaseAuthChanged", user || null);
      });
    } catch (e) {
      console.warn("Firebase init failed", e);
      ready.enabled = false;
      setUi(null);
    }
  });
})();
