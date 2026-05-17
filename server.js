const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 8e6
});

const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const BAD_WORDS = [
  "fuck","fck","shit","bitch","nude","porn","sex","kill","suicide","terror","rape",
  "nigger","nigga","nigg","niga","n1gga","n1gger",
  "chutiya","chutia","bhosdi","bhosdike","madarchod","behenchod","randi","mc","bc"
];

const WORD_POOL = (() => {
  try { return require("./prompt-words.json"); } catch (_) { return []; }
})();
const FALLBACK_PROMPTS = ["Apple","Banana","Car","Cat","Dog","House","Tree","Robot","Dragon","Guitar"];
const PROMPTS = {
  Normal: WORD_POOL.length ? WORD_POOL : FALLBACK_PROMPTS,
  Medium: WORD_POOL.length ? WORD_POOL : FALLBACK_PROMPTS,
  Hard: WORD_POOL.length ? WORD_POOL : FALLBACK_PROMPTS
};

const rooms = new Map();
const sessions = new Map();

const COSMETICS = require("./public/cosmetics-data.json");
const ITEM_MAP = new Map([...COSMETICS.avatars, ...COSMETICS.banners, ...COSMETICS.decorations].map(i => [i.id, i]));
const DEFAULT_OWNED = [...COSMETICS.freeAvatarIds, ...COSMETICS.freeBannerIds];
const DATA_DIR = path.join(__dirname, "data");
const PROFILE_FILE = path.join(DATA_DIR, "profiles.json");
let profiles = {};
try { fs.mkdirSync(DATA_DIR, { recursive: true }); profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8")); } catch (_) { profiles = {}; }
function saveProfiles() { try { fs.writeFileSync(PROFILE_FILE, JSON.stringify(profiles, null, 2)); } catch (e) { console.error("Profile save failed", e.message); } }

const USERNAME_CHANGE_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000;

function safeCleanText(value, max = 80) {
  const cleaned = cleanText(String(value ?? ""), max);
  return String(cleaned ?? "").trim();
}

function normalizeUsername(name) {
  return safeCleanText(name, 24).replace(/\s+/g, " ").toLowerCase();
}
function isValidUsername(name) {
  const n = safeCleanText(name, 24);
  // 3-18 chars, letters/numbers/space/underscore only, must contain at least one letter/number.
  return n.length >= 3 && n.length <= 18 && /^[A-Za-z0-9_ ]+$/.test(n) && /[A-Za-z0-9]/.test(n);
}
function usernameTakenBy(normalized, profileId) {
  normalized = normalizeUsername(normalized);
  if (!normalized) return null;
  for (const [pid, p] of Object.entries(profiles)) {
    if (pid !== profileId && normalizeUsername(p.username) === normalized && p.setupComplete) return pid;
  }
  return null;
}
function usernameCooldownLeft(profile) {
  if (!profile?.lastUsernameChangeAt) return 0;
  return Math.max(0, USERNAME_CHANGE_COOLDOWN_MS - (Date.now() - Number(profile.lastUsernameChangeAt || 0)));
}
function setProfileUsername(profile, desiredName, mode = "setup") {
  const clean = safeCleanText(desiredName, 24).replace(/\s+/g, " ");
  if (!isValidUsername(clean)) return { ok: false, message: "Username must be 3-18 letters/numbers. Spaces and _ allowed." };
  const normalized = normalizeUsername(clean);
  const taken = usernameTakenBy(normalized, profile.profileId);
  if (taken) return { ok: false, message: "Username already taken." };
  if (normalizeUsername(profile.username) === normalized && profile.setupComplete) return { ok: true, profile };
  if (mode === "change") {
    const left = usernameCooldownLeft(profile);
    if (left > 0) {
      const days = Math.ceil(left / (24 * 60 * 60 * 1000));
      return { ok: false, message: `You can change username after ${days} day${days === 1 ? "" : "s"}.` };
    }
  }
  profile.username = clean;
  profile.usernameNormalized = normalized;
  if (!profile.usernameSetAt) profile.usernameSetAt = Date.now();
  profile.lastUsernameChangeAt = Date.now();
  profile.setupComplete = true;
  return { ok: true, profile };
}

function makeDefaultProfile(profileId, username = "") {
  return {
    profileId,
    username: cleanText(username, 24) || "",
    usernameNormalized: username ? normalizeUsername(username) : "",
    setupComplete: false,
    usernameSetAt: 0,
    lastUsernameChangeAt: 0,
    coins: 0,
    xp: 0,
    level: 1,
    wins: 0,
    matches: 0,
    daily: { lastClaim: 0, streak: 0 },
    badges: [],
    friends: [],
    friendRequestsIn: [],
    friendRequestsOut: [],
    owned: [...DEFAULT_OWNED],
    avatarId: COSMETICS.freeAvatarIds[0] || "free_purple_glasses",
    bannerId: COSMETICS.freeBannerIds[0] || "banner_free_pink",
    decoId: ""
  };
}
function getProfile(profileId, username = "") {
  profileId = cleanText(profileId, 90) || nanoid(12);
  if (!profiles[profileId]) {
    profiles[profileId] = makeDefaultProfile(profileId, "");
    if (username && isValidUsername(username) && !usernameTakenBy(normalizeUsername(username), profileId)) {
      // Do not fully reserve names automatically from Google display name.
      // Name reservation happens only after the first-time setup screen.
      const safeName = safeCleanText(username, 24);
      profiles[profileId].username = safeName.replace(/\s+/g, " ");
      profiles[profileId].usernameNormalized = normalizeUsername(username);
    }
    saveProfiles();
  }
  return profiles[profileId];
}
function sanitizeProfile(p) {
  if (!p || typeof p !== "object") p = makeDefaultProfile("guest-" + Math.random().toString(36).slice(2,10), "");
  p.owned = Array.isArray(p.owned) ? [...new Set([...DEFAULT_OWNED, ...p.owned])] : [...DEFAULT_OWNED];
  if (!ITEM_MAP.has(p.avatarId)) p.avatarId = COSMETICS.freeAvatarIds[0];
  if (!ITEM_MAP.has(p.bannerId)) p.bannerId = COSMETICS.freeBannerIds[0];
  if (p.decoId && !ITEM_MAP.has(p.decoId)) p.decoId = "";
  p.matches = Math.max(0, Number(p.matches || 0));
  p.level = Math.max(1, Math.floor((p.xp || 0) / 250) + 1);
  const safeProfileName = safeCleanText(p.username || "", 24);
  p.username = safeProfileName.replace(/\s+/g, " ");
  p.usernameNormalized = normalizeUsername(p.username);
  p.setupComplete = !!p.setupComplete || (!!p.username && p.username !== "Player" && !!p.usernameSetAt);
  p.usernameSetAt = Number(p.usernameSetAt || (p.setupComplete ? Date.now() : 0));
  p.lastUsernameChangeAt = Number(p.lastUsernameChangeAt || p.usernameSetAt || 0);
  p.friends = Array.isArray(p.friends) ? [...new Set(p.friends)] : [];
  p.friendRequestsIn = Array.isArray(p.friendRequestsIn) ? [...new Set(p.friendRequestsIn)] : [];
  p.friendRequestsOut = Array.isArray(p.friendRequestsOut) ? [...new Set(p.friendRequestsOut)] : [];
  p.badges = Array.isArray(p.badges) ? [...new Set(p.badges)] : [];
  p.daily = p.daily && typeof p.daily === "object" ? p.daily : { lastClaim: 0, streak: 0 };
  p.daily.lastClaim = Number(p.daily.lastClaim || 0);
  p.daily.streak = Number(p.daily.streak || 0);
  return p;
}

function profilePublicLite(profileId) {
  const p = profiles[profileId] ? sanitizeProfile(profiles[profileId]) : null;
  if (!p) return null;
  return {
    profileId: p.profileId,
    username: p.username || "Player",
    avatarId: p.avatarId,
    bannerId: p.bannerId,
    decoId: p.decoId || "",
    level: p.level || 1,
    wins: p.wins || 0,
    matches: p.matches || 0,
    xp: p.xp || 0
  };
}
function findProfileByUsername(name) {
  const n = normalizeUsername(name);
  if (!n) return null;
  for (const p of Object.values(profiles)) {
    const clean = sanitizeProfile(p);
    if (clean.setupComplete && normalizeUsername(clean.username) === n) return clean;
  }
  return null;
}
function buildFriendsPayload(profile) {
  profile = sanitizeProfile(profile);
  return {
    friends: profile.friends.map(profilePublicLite).filter(Boolean),
    requestsIn: profile.friendRequestsIn.map(profilePublicLite).filter(Boolean),
    requestsOut: profile.friendRequestsOut.map(profilePublicLite).filter(Boolean)
  };
}
function emitFriends(socket, profile) {
  try { socket.emit("friendsData", buildFriendsPayload(profile)); } catch (e) { console.error("emitFriends failed", e.message); }
}
function isSameDay(a, b) {
  const da = new Date(Number(a || 0));
  const db = new Date(Number(b || 0));
  return da.getUTCFullYear() === db.getUTCFullYear() && da.getUTCMonth() === db.getUTCMonth() && da.getUTCDate() === db.getUTCDate();
}
function addBadge(profile, id) {
  profile.badges = Array.isArray(profile.badges) ? profile.badges : [];
  if (!profile.badges.includes(id)) profile.badges.push(id);
}
function updateBadges(profile) {
  profile = sanitizeProfile(profile);
  if ((profile.wins || 0) >= 1) addBadge(profile, "First Win 🏆");
  if ((profile.wins || 0) >= 10) addBadge(profile, "10 Wins 🔥");
  if ((profile.matches || 0) >= 5) addBadge(profile, "Regular Artist ✏️");
  if ((profile.level || 1) >= 5) addBadge(profile, "Level 5 ⭐");
  return profile;
}

function awardMatchRewards(room) {
  if (room.rewardsAwarded) return;
  room.rewardsAwarded = true;
  room.rewards = {};
  const ranking = [...room.players].sort((a,b) => (b.score || 0) - (a.score || 0));
  const small = ranking.length <= 3;
  const coinTable = small ? [20, 10, 0] : [60, 35, 15];
  const xpTable = [120, 80, 50];
  ranking.forEach((player, index) => {
    if (!player.profileId) return;
    const profile = sanitizeProfile(getProfile(player.profileId, player.username));
    const coins = coinTable[index] || 0;
    const xp = xpTable[index] || 15;
    profile.coins = (profile.coins || 0) + coins;
    profile.xp = (profile.xp || 0) + xp;
    profile.matches = (profile.matches || 0) + 1;
    if (index === 0) profile.wins = (profile.wins || 0) + 1;
    sanitizeProfile(profile);
    room.rewards[player.sessionId] = { coins, xp, place: index + 1 };
    const sess = sessions.get(player.sessionId);
    if (sess?.socketId) io.to(sess.socketId).emit("profileData", profile);
  });
  saveProfiles();
}


function estimateDrawingAccuracy(image) {
  // Lightweight local scoring helper. This rewards effort/non-blank drawings.
  // True semantic object detection, e.g. "apple looks like apple", needs a real vision moderation/AI service key.
  if (typeof image !== "string" || !image.startsWith("data:image/")) return 0;
  const len = image.length;
  if (len < 18000) return 0;
  if (len < 45000) return 8;
  if (len < 95000) return 16;
  if (len < 180000) return 24;
  return 30;
}

function moderateDrawingImage(image) {
  // Safe default: no automatic adult/illegal image detection without a real AI moderation provider.
  // Host/user reports can flag a drawing as unsafe, then it is blurred for non-hosts.
  return { unsafe: false, reason: "" };
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/[^a-z0-9]/g, "");
}

function cleanText(text, max = 80) {
  const raw = String(text || "").replace(/[<>]/g, "").trim();
  if (!raw) return null;
  const compact = normalize(raw);
  const lower = raw.toLowerCase();
  if (BAD_WORDS.some(w => lower.includes(w) || compact.includes(normalize(w)))) return null;
  return raw.slice(0, max);
}

function publicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    type: room.type,
    players: room.players.length,
    slots: room.settings.slots,
    mode: room.settings.mode,
    roomMode: room.settings.roomMode || "Classic",
    phase: room.phase
  };
}

function getRoomList() {
  return [...rooms.values()].filter(r => r.type === "Public Room").map(publicRoom);
}

function makeRoomCode() {
  let code;
  do { code = "DB-" + nanoid(4).toUpperCase(); } while (rooms.has(code));
  return code;
}

function makeRoom({ name, type, settings }) {
  const code = makeRoomCode();
  return {
    code,
    name,
    type,
    settings: {
      slots: Number(settings.slots || 10),
      timer: Number(settings.timer || 180),
      rounds: Number(settings.rounds || 8),
      mode: settings.mode || "Hard",
      roomMode: ["Classic","Speed","Blind Draw","No Eraser","One Color","Hard Prompt"].includes(settings.roomMode) ? settings.roomMode : "Classic"
    },
    players: [],
    hostSessionId: null,
    phase: "lobby",
    round: 0,
    currentPrompt: "",
    usedPrompts: [],
    drawings: new Map(),
    votes: new Map(),
    reactionCounts: {},
    rewards: {},
    rewardsAwarded: false,
    timerEndsAt: null,
    timerHandle: null,
    chat: []
  };
}

function choosePrompt(room) {
  const list = PROMPTS[room.settings.mode] || PROMPTS.Hard;
  room.usedPrompts = room.usedPrompts || [];
  room.recentPrompts = room.recentPrompts || [];

  let pool = list.filter(p => 
    !room.usedPrompts.includes(p) &&
    !room.recentPrompts.includes(p)
  );

  if (!pool.length) {
    room.usedPrompts = [];
    pool = list.filter(p => !room.recentPrompts.includes(p));
  }

  const prompt = pool[Math.floor(Math.random() * pool.length)];

  room.usedPrompts.push(prompt);
  room.recentPrompts.push(prompt);

  if (room.recentPrompts.length > 25) {
    room.recentPrompts.shift();
  }

  return prompt;
}

function broadcastRoom(room) {
  io.to(room.code).emit("roomState", serializeRoom(room));
  io.emit("publicRooms", getRoomList());
}

function serializeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    type: room.type,
    settings: room.settings,
    players: room.players.map(p => ({
      sessionId: p.sessionId,
      username: p.username,
      avatarSeed: p.avatarSeed,
      profileId: p.profileId || "",
      bannerId: p.bannerId || "",
      decoId: p.decoId || "",
      level: sanitizeProfile(profiles[p.profileId] || p).level || p.level || 1,
      xp: sanitizeProfile(profiles[p.profileId] || p).xp || 0,
      wins: sanitizeProfile(profiles[p.profileId] || p).wins || 0,
      matches: sanitizeProfile(profiles[p.profileId] || p).matches || 0,
      score: p.score,
      host: p.sessionId === room.hostSessionId,
      connected: p.connected,
      reported: p.reported || 0,
      drawingSubmitted: room.drawings.has(p.sessionId)
    })),
    phase: room.phase,
    round: room.round,
    totalRounds: room.settings.rounds,
    currentPrompt: room.phase === "draw" ? room.currentPrompt : "",
    timerEndsAt: room.timerEndsAt,
    chat: room.chat.slice(-50),
    drawings: room.phase === "vote" || room.phase === "roundResults" || room.phase === "results"
      ? [...room.drawings.values()].map(d => ({ sessionId: d.sessionId, username: d.username, avatarSeed: d.avatarSeed, decoId: d.decoId || "", image: d.image, afk: d.afk || false, unsafe: !!d.unsafe, unsafeReports: d.unsafeReports || 0, moderationReason: d.moderationReason || "", accuracyScore: d.accuracyScore || 0 }))
      : [],
    reactionCounts: room.reactionCounts,
    rewards: room.rewards || {}
  };
}

function addChat(room, msg) {
  room.chat.push(msg);
  if (room.chat.length > 60) room.chat.shift();
  io.to(room.code).emit("chat", room.chat.slice(-50));
}

function endTimer(room) {
  clearTimeout(room.timerHandle);
  room.timerHandle = null;
}

function startRound(room) {
  endTimer(room);
  room.round += 1;
  room.phase = "intro";
  room.currentPrompt = choosePrompt(room);
  room.drawings.clear();
  room.votes.clear();
  room.reactionCounts = {};
  room.timerEndsAt = Date.now() + 7000;
  broadcastRoom(room);

  room.timerHandle = setTimeout(() => {
    room.phase = "draw";
    const drawSeconds = room.settings.roomMode === "Speed" ? Math.min(Number(room.settings.timer || 60), 60) : Number(room.settings.timer || 180);
    room.timerEndsAt = Date.now() + drawSeconds * 1000;
    broadcastRoom(room);
    room.timerHandle = setTimeout(() => startVoting(room), drawSeconds * 1000 + 300);
  }, 7000);
}

function startVoting(room) {
  endTimer(room);
  // AFK auto-submit blank drawing for missing players
  for (const p of room.players) {
    if (!room.drawings.has(p.sessionId)) {
      room.drawings.set(p.sessionId, {
        sessionId: p.sessionId,
        username: p.username,
        avatarSeed: p.avatarSeed,
        decoId: p.decoId || "",
        image: null,
        afk: true,
        unsafe: false,
        unsafeReports: 0,
        accuracyScore: 0
      });
    }
  }
  room.phase = "vote";
  room.votes.clear();
  room.timerEndsAt = Date.now() + 40000;
  broadcastRoom(room);
  room.timerHandle = setTimeout(() => finishVoting(room), 40300);
}

function finishVoting(room) {
  endTimer(room);
  const totals = {};
  for (const votedId of room.votes.values()) totals[votedId] = (totals[votedId] || 0) + 1;
  // no votes fallback
  if (!Object.keys(totals).length && room.players.length) {
    const random = room.players[Math.floor(Math.random() * room.players.length)];
    totals[random.sessionId] = 1;
  }
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  let topVotes = sorted.length ? sorted[0][1] : 0;

  sorted.forEach(([sessionId, votes], idx) => {
    const p = room.players.find(x => x.sessionId === sessionId);
    if (!p) return;

    let bonus = 0;

    // Tie = both first place
    if (votes === topVotes && topVotes > 0) {
      bonus += 150;
    }

    // Small creativity bonus simulation
    bonus += Math.floor(Math.random() * 40);

    p.score += votes * 100 + bonus;
  });

  // Drawing effort / detector hook bonus. Real semantic AI can replace estimateDrawingAccuracy later.
  for (const drawing of room.drawings.values()) {
    const p = room.players.find(x => x.sessionId === drawing.sessionId);
    if (p && drawing.accuracyScore) p.score += drawing.accuracyScore;
  }
  room.phase = "roundResults";
  room.timerEndsAt = Date.now() + 4000;
  broadcastRoom(room);

  room.timerHandle = setTimeout(() => {
    if (room.round >= room.settings.rounds) {
      room.phase = "results";
      room.timerEndsAt = null;
      awardMatchRewards(room);
      broadcastRoom(room);
    } else {
      startRound(room);
    }
  }, 4200);
}

function mergeCloudProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const profileId = cleanText(raw.profileId, 80);
  if (!profileId || !profileId.startsWith("fb_")) return null;
  const current = getProfile(profileId, raw.username || "");
  // Username is protected/reserved. Cloud sync cannot silently take or change a name.
  if (!current.setupComplete && raw.setupComplete && raw.username) {
    const set = setProfileUsername(current, raw.username, "setup");
    if (!set.ok) current.username = "";
  }
  current.coins = Math.max(0, Number(raw.coins || current.coins || 0));
  current.xp = Math.max(0, Number(raw.xp || current.xp || 0));
  current.wins = Math.max(0, Number(raw.wins || current.wins || 0));
  current.matches = Math.max(0, Number(raw.matches || current.matches || 0));
  current.owned = Array.isArray(raw.owned) ? raw.owned.filter(id => ITEM_MAP.has(id)).slice(0, 300) : current.owned;
  current.avatarId = ITEM_MAP.has(raw.avatarId) ? raw.avatarId : current.avatarId;
  current.bannerId = ITEM_MAP.has(raw.bannerId) ? raw.bannerId : current.bannerId;
  current.decoId = raw.decoId && ITEM_MAP.has(raw.decoId) ? raw.decoId : "";
  sanitizeProfile(current);
  saveProfiles();
  return current;
}

function equipProfileItem(profile, item) {
  if (item.kind === "avatar") profile.avatarId = item.id;
  if (item.kind === "banner") profile.bannerId = item.id;
  if (item.kind === "deco") profile.decoId = item.id;
}

function syncProfileToActivePlayer(sessionId, profile) {
  const sess = sessions.get(sessionId);
  const room = sess?.roomCode ? rooms.get(sess.roomCode) : null;
  if (!room) return;
  const player = room.players.find(p => p.sessionId === sessionId || p.profileId === profile.profileId);
  if (!player) return;
  player.profileId = profile.profileId;
  player.username = profile.username || player.username;
  player.avatarSeed = profile.avatarId || player.avatarSeed;
  player.bannerId = profile.bannerId || player.bannerId;
  player.decoId = profile.decoId || "";
  player.level = profile.level || 1;
  player.wins = profile.wins || 0;
  player.matches = profile.matches || 0;
  player.xp = profile.xp || 0;
  broadcastRoom(room);
}

function isHost(socket, room) {
  const sessionId = socket.data.sessionId;
  return room && room.hostSessionId === sessionId;
}

io.on("connection", (socket) => {
  socket.emit("publicRooms", getRoomList());

  socket.on("identify", ({ sessionId }) => {
    if (!sessionId) sessionId = nanoid(16);
    socket.data.sessionId = sessionId;
    sessions.set(sessionId, { socketId: socket.id, roomCode: sessions.get(sessionId)?.roomCode || null });
    socket.emit("session", { sessionId });

    // reconnect
    const old = sessions.get(sessionId);
    const roomCode = old?.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (room) {
      const player = room.players.find(p => p.sessionId === sessionId);
      if (player) {
        player.connected = true;
        socket.join(room.code);
        broadcastRoom(room);
        socket.emit("notice", "🔄 Reconnected to room.");
      }
    }
  });



  socket.on("profileLogin", ({ profileId, username }) => {
    const profile = sanitizeProfile(getProfile(profileId, username));
    socket.emit("profileData", profile);
  });

  socket.on("profileSetup", ({ profileId, username, avatarId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    if (profile.setupComplete) return socket.emit("profileData", profile);
    const result = setProfileUsername(profile, username, "setup");
    if (!result.ok) return socket.emit("profileSetupError", result.message);
    if (ITEM_MAP.has(avatarId) && profile.owned.includes(avatarId)) profile.avatarId = avatarId;
    sanitizeProfile(profile);
    saveProfiles();
    syncProfileToActivePlayer(socket.data.sessionId, profile);
    socket.emit("profileData", profile);
    socket.emit("notice", "Username reserved successfully.");
  });

  socket.on("profileUsernameChange", ({ profileId, username }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    const result = setProfileUsername(profile, username, "change");
    if (!result.ok) return socket.emit("profileSetupError", result.message);
    sanitizeProfile(profile);
    saveProfiles();
    syncProfileToActivePlayer(socket.data.sessionId, profile);
    socket.emit("profileData", profile);
    socket.emit("notice", "Username changed successfully.");
  });

  socket.on("profileCloudSync", ({ profile }) => {
    const merged = mergeCloudProfile(profile);
    if (!merged) return socket.emit("shopError", "Cloud profile sync failed.");
    syncProfileToActivePlayer(socket.data.sessionId, merged);
    socket.emit("profileData", merged);
  });

  socket.on("getProfile", ({ profileId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    socket.emit("profileData", profile);
  });

  socket.on("profileUpdate", ({ profileId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    saveProfiles();
    syncProfileToActivePlayer(socket.data.sessionId, profile);
    socket.emit("profileData", profile);
  });

  socket.on("buyItem", ({ profileId, itemId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    const item = ITEM_MAP.get(itemId);
    if (!item) return socket.emit("shopError", "Item not found.");
    if (!profile.owned.includes(itemId)) {
      if ((profile.coins || 0) < (item.price || 0)) return socket.emit("shopError", "Not enough coins.");
      profile.coins -= item.price || 0;
      profile.owned.push(itemId);
    }
    equipProfileItem(profile, item);
    sanitizeProfile(profile);
    saveProfiles();
    syncProfileToActivePlayer(socket.data.sessionId, profile);
    socket.emit("profileData", profile);
  });

  socket.on("equipItem", ({ profileId, itemId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    const item = ITEM_MAP.get(itemId);
    if (!item) return socket.emit("shopError", "Item not found.");
    if (!profile.owned.includes(itemId)) return socket.emit("shopError", "Buy this item first.");
    if (item.kind === "deco" && profile.decoId === itemId) profile.decoId = "";
    else equipProfileItem(profile, item);
    sanitizeProfile(profile);
    saveProfiles();
    syncProfileToActivePlayer(socket.data.sessionId, profile);
    socket.emit("profileData", profile);
  });

  socket.on("createRoom", ({ username, avatarSeed, profileId, bannerId, decoId, roomName, type, settings }) => {
    username = safeCleanText(username, 24);
    roomName = safeCleanText(roomName, 50);
    if (!username) return socket.emit("errorMsg", "Bad/empty username not allowed.");
    if (!roomName) roomName = `${username}'s Drawing Room`;
    type = type === "Public Room" ? "Public Room" : "Private Room";
    const room = makeRoom({ name: roomName, type, settings: settings || {} });
    const sessionId = socket.data.sessionId || nanoid(16);
    socket.data.sessionId = sessionId;
    room.hostSessionId = sessionId;
    const prof = profileId ? sanitizeProfile(getProfile(profileId)) : null;
    if (!prof || !prof.setupComplete || !prof.username) return socket.emit("errorMsg", "Complete username setup first.");
    username = prof.username;
    if (!roomName || roomName === "Player's Drawing Room") roomName = `${username}'s Drawing Room`;
    const owned = new Set(prof?.owned || []);
    avatarSeed = owned.has(avatarSeed) ? avatarSeed : (prof?.avatarId || COSMETICS.freeAvatarIds[0]);
    bannerId = owned.has(bannerId) ? bannerId : (prof?.bannerId || COSMETICS.freeBannerIds[0]);
    decoId = owned.has(decoId) ? decoId : (prof?.decoId || "");
    room.players.push({ sessionId, profileId: prof?.profileId || "", username, avatarSeed: avatarSeed || COSMETICS.freeAvatarIds[0], bannerId, decoId, level: prof?.level || 1, wins: prof?.wins || 0, matches: prof?.matches || 0, xp: prof?.xp || 0, score: 0, connected: true, lastActive: Date.now() });
    rooms.set(room.code, room);
    sessions.set(sessionId, { socketId: socket.id, roomCode: room.code });
    socket.join(room.code);
    socket.emit("joinedRoom", { code: room.code });
    broadcastRoom(room);
  });

  socket.on("joinRoom", ({ code, username, avatarSeed, profileId, bannerId, decoId }) => {
    username = safeCleanText(username, 24);
    if (!username) return socket.emit("errorMsg", "Bad/empty username not allowed.");
    code = String(code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMsg", "Room not found.");
    if (room.players.length >= room.settings.slots) return socket.emit("errorMsg", "Room is full.");
    if (room.phase !== "lobby") return socket.emit("errorMsg", "Game already started.");
    const sessionId = socket.data.sessionId || nanoid(16);
    socket.data.sessionId = sessionId;
    let player = room.players.find(p => p.sessionId === sessionId);
    const prof = profileId ? sanitizeProfile(getProfile(profileId)) : null;
    if (!prof || !prof.setupComplete || !prof.username) return socket.emit("errorMsg", "Complete username setup first.");
    username = prof.username;
    const owned = new Set(prof?.owned || []);
    avatarSeed = owned.has(avatarSeed) ? avatarSeed : (prof?.avatarId || COSMETICS.freeAvatarIds[0]);
    bannerId = owned.has(bannerId) ? bannerId : (prof?.bannerId || COSMETICS.freeBannerIds[0]);
    decoId = owned.has(decoId) ? decoId : (prof?.decoId || "");
    if (!player) {
      player = { sessionId, profileId: prof?.profileId || "", username, avatarSeed: avatarSeed || COSMETICS.freeAvatarIds[0], bannerId, decoId, level: prof?.level || 1, wins: prof?.wins || 0, matches: prof?.matches || 0, xp: prof?.xp || 0, score: 0, connected: true, lastActive: Date.now() };
      room.players.push(player);
    } else {
      player.connected = true;
      player.profileId = prof?.profileId || player.profileId || "";
      player.username = username;
      player.avatarSeed = avatarSeed || player.avatarSeed;
      player.bannerId = bannerId || player.bannerId;
      player.decoId = decoId || player.decoId || "";
      player.level = prof?.level || player.level || 1;
      player.wins = prof?.wins || player.wins || 0;
      player.matches = prof?.matches || player.matches || 0;
      player.xp = prof?.xp || player.xp || 0;
    }
    sessions.set(sessionId, { socketId: socket.id, roomCode: room.code });
    socket.join(room.code);
    socket.emit("joinedRoom", { code: room.code });
    broadcastRoom(room);
  });

  socket.on("updateSettings", ({ code, settings, name, type }) => {
    const room = rooms.get(code);
    if (!isHost(socket, room) || room.phase !== "lobby") return;
    const cleanRoomName = safeCleanText(name, 50); if (cleanRoomName) room.name = cleanRoomName;
    if (type === "Public Room" || type === "Private Room") room.type = type;
    room.settings = {
      slots: Number(settings?.slots || room.settings.slots),
      timer: Number(settings?.timer || room.settings.timer),
      rounds: Number(settings?.rounds || room.settings.rounds),
      mode: ["Normal","Medium","Hard"].includes(settings?.mode) ? settings.mode : room.settings.mode,
      roomMode: ["Classic","Speed","Blind Draw","No Eraser","One Color","Hard Prompt"].includes(settings?.roomMode) ? settings.roomMode : (room.settings.roomMode || "Classic")
    };
    broadcastRoom(room);
  });

  socket.on("startGame", ({ code }) => {
    const room = rooms.get(code);
    if (!isHost(socket, room)) return;
    if (!["lobby", "results"].includes(room.phase)) return;
    const connectedPlayers = room.players.filter(p => p.connected);
    if (connectedPlayers.length < 2) return socket.emit("errorMsg", "Minimum 2 players required to start the game.");
    room.round = 0;
    room.usedPrompts = [];
    room.rewards = {};
    room.rewardsAwarded = false;
    room.players.forEach(p => p.score = 0);
    startRound(room);
  });

  socket.on("stroke", ({ code }) => {
    // Private canvas mode:
    // Drawing is NOT broadcast live to other players.
    // Players only see drawings after submit during voting.
    const room = rooms.get(code);
    if (!room || room.phase !== "draw") return;
    const player = room.players.find(p => p.sessionId === socket.data.sessionId);
    if (player) player.lastActive = Date.now();
  });

  socket.on("submitDrawing", ({ code, image }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "draw") return;
    const player = room.players.find(p => p.sessionId === socket.data.sessionId);
    if (!player) return;
    player.lastActive = Date.now();
    const safeImage = typeof image === "string" && image.length < 6_000_000 ? image : null;
    const moderation = moderateDrawingImage(safeImage);
    room.drawings.set(player.sessionId, {
      sessionId: player.sessionId,
      username: player.username,
      avatarSeed: player.avatarSeed,
      decoId: player.decoId || "",
      image: safeImage,
      unsafe: !!moderation.unsafe,
      unsafeReports: 0,
      moderationReason: moderation.reason || "",
      accuracyScore: estimateDrawingAccuracy(safeImage)
    });
    broadcastRoom(room);
    if (room.drawings.size >= room.players.length) startVoting(room);
  });

  socket.on("vote", ({ code, targetSessionId }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "vote") return;
    const voterId = socket.data.sessionId;
    if (voterId === targetSessionId) return;
    if (!room.players.some(p => p.sessionId === targetSessionId)) return;
    room.votes.set(voterId, targetSessionId);
    socket.emit("notice", "Vote saved.");

    // Auto-finish voting when all connected eligible players have voted.
    const connectedEligible = room.players.filter(p => p.connected);
    const neededVotes = connectedEligible.filter(p => room.players.some(t => t.sessionId !== p.sessionId)).length;
    if (neededVotes > 0 && room.votes.size >= neededVotes) {
      finishVoting(room);
    }
  });


  socket.on("reportUnsafeDrawing", ({ code, targetSessionId }) => {
    const room = rooms.get(code);
    if (!room || !["vote", "roundResults", "results"].includes(room.phase)) return;
    const reporter = room.players.find(p => p.sessionId === socket.id);
    if (!reporter || !reporter.host) {
      socket.emit("errorMsg", "Only the host can report images.");
      return;
    }
    const drawing = room.drawings.get(targetSessionId);
    if (!drawing) return;
    drawing.unsafe = true;
    drawing.unsafeReports = (drawing.unsafeReports || 0) + 1;
    drawing.moderationReason = "Reported as adult/illegal by the host.";
    socket.emit("notice", "Drawing reported. Other players now see a blurred version.");
    broadcastRoom(room);
  });


  socket.on("claimDaily", ({ profileId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    const now = Date.now();
    if (profile.daily.lastClaim && isSameDay(profile.daily.lastClaim, now)) {
      socket.emit("shopError", "Daily reward already claimed today.");
      return;
    }
    const yesterday = now - 24 * 60 * 60 * 1000;
    profile.daily.streak = profile.daily.lastClaim && isSameDay(profile.daily.lastClaim, yesterday) ? (profile.daily.streak || 0) + 1 : 1;
    profile.daily.lastClaim = now;
    const coins = profile.daily.streak >= 7 ? 25 : 10 + Math.min(profile.daily.streak - 1, 4) * 5;
    const xp = 25 + Math.min(profile.daily.streak, 7) * 5;
    profile.coins = (profile.coins || 0) + coins;
    profile.xp = (profile.xp || 0) + xp;
    updateBadges(profile);
    sanitizeProfile(profile);
    saveProfiles();
    socket.emit("profileData", profile);
    socket.emit("notice", `Daily reward claimed: +${coins} coins, +${xp} XP`);
  });

  socket.on("getFriends", ({ profileId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    emitFriends(socket, profile);
  });

  socket.on("sendFriendRequest", ({ profileId, username }) => {
    const from = sanitizeProfile(getProfile(profileId));
    const to = findProfileByUsername(username);
    if (!to) return socket.emit("shopError", "User not found.");
    if (to.profileId === from.profileId) return socket.emit("shopError", "You cannot add yourself.");
    if (from.friends.includes(to.profileId)) return socket.emit("shopError", "Already friends.");
    if (!from.friendRequestsOut.includes(to.profileId)) from.friendRequestsOut.push(to.profileId);
    if (!to.friendRequestsIn.includes(from.profileId)) to.friendRequestsIn.push(from.profileId);
    saveProfiles();
    emitFriends(socket, from);
    socket.emit("notice", "Friend request sent.");
  });

  socket.on("respondFriendRequest", ({ profileId, fromProfileId, accept }) => {
    const me = sanitizeProfile(getProfile(profileId));
    const other = profiles[fromProfileId] ? sanitizeProfile(profiles[fromProfileId]) : null;
    if (!other) return socket.emit("shopError", "Request user not found.");
    me.friendRequestsIn = me.friendRequestsIn.filter(id => id !== other.profileId);
    other.friendRequestsOut = other.friendRequestsOut.filter(id => id !== me.profileId);
    if (accept) {
      if (!me.friends.includes(other.profileId)) me.friends.push(other.profileId);
      if (!other.friends.includes(me.profileId)) other.friends.push(me.profileId);
    }
    saveProfiles();
    emitFriends(socket, me);
    socket.emit("notice", accept ? "Friend added." : "Friend request declined.");
  });

  socket.on("removeFriend", ({ profileId, friendProfileId }) => {
    const me = sanitizeProfile(getProfile(profileId));
    const other = profiles[friendProfileId] ? sanitizeProfile(profiles[friendProfileId]) : null;
    me.friends = me.friends.filter(id => id !== friendProfileId);
    if (other) other.friends = other.friends.filter(id => id !== me.profileId);
    saveProfiles();
    emitFriends(socket, me);
    socket.emit("notice", "Friend removed.");
  });

  socket.on("lobbyEmote", ({ code, emote }) => {
    const room = rooms.get(code);
    if (!room || !room.players.some(p => p.sessionId === socket.data.sessionId)) return;
    emote = cleanText(emote, 4);
    if (!["😂","🔥","💀","😭","👀"].includes(emote)) return;
    io.to(room.code).emit("lobbyEmote", { sessionId: socket.data.sessionId, emote });
  });


  socket.on("reaction", ({ code, targetSessionId, reaction }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "vote") return;
    reaction = cleanText(reaction, 30);
    if (!reaction) return;
    const key = `${targetSessionId}:${reaction}`;
    room.reactionCounts[key] = (room.reactionCounts[key] || 0) + 1;
    io.to(code).emit("reaction", { targetSessionId, reaction });
  });

  socket.on("chat", ({ code, message }) => {
    const room = rooms.get(code);
    if (!room) return;
    message = cleanText(message, 140);
    if (!message) return socket.emit("errorMsg", "Bad/empty chat blocked.");
    const player = room.players.find(p => p.sessionId === socket.data.sessionId);
    if (!player) return;
    player.lastActive = Date.now();
    addChat(room, { username: player.username, avatarSeed: player.avatarSeed, message, time: Date.now() });
  });

  socket.on("kick", ({ code, targetSessionId }) => {
    const room = rooms.get(code);
    if (!isHost(socket, room)) return;
    if (targetSessionId === room.hostSessionId) return;
    const idx = room.players.findIndex(p => p.sessionId === targetSessionId);
    if (idx >= 0) {
      const [kicked] = room.players.splice(idx, 1);
      const s = sessions.get(kicked.sessionId);
      if (s) s.roomCode = null;
      if (s?.socketId) {
        io.to(s.socketId).emit("kicked", { message: "You have been kicked by the host." });
        const kickedSocket = io.sockets.sockets.get(s.socketId);
        if (kickedSocket) kickedSocket.leave(room.code);
      }

      if (!room.players.length) {
        endTimer(room);
        rooms.delete(room.code);
        io.emit("publicRooms", getRoomList());
        return;
      }

      broadcastRoom(room);
    }
  });

  socket.on("report", ({ code, targetSessionId }) => {
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.find(x => x.sessionId === targetSessionId);
    if (p) {
      p.reported = (p.reported || 0) + 1;
      socket.emit("notice", "Report received.");
      broadcastRoom(room);
    }
  });

  socket.on("finishVoting", ({ code }) => {
    const room = rooms.get(code);
    if (!isHost(socket, room) || room.phase !== "vote") return;
    finishVoting(room);
  });


  socket.on("leaveRoom", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    const sessionId = socket.data.sessionId;
    const idx = room.players.findIndex(p => p.sessionId === sessionId);
    if (idx >= 0) {
      const wasHost = room.hostSessionId === sessionId;
      room.players.splice(idx, 1);
      socket.leave(room.code);
      const s = sessions.get(sessionId);
      if (s) s.roomCode = null;

      if (!room.players.length) {
        endTimer(room);
        rooms.delete(room.code);
        io.emit("publicRooms", getRoomList());
        socket.emit("leftRoom");
        return;
      }

      if (wasHost) {
        // Host left: next connected player becomes host automatically.
        const nextHost = room.players.find(p => p.connected) || room.players[0];
        room.hostSessionId = nextHost.sessionId;
        addChat(room, {
          username: "System",
          avatarSeed: "Robot",
          message: `${nextHost.username} is the new host.`,
          time: Date.now()
        });
      }

      socket.emit("leftRoom");
      broadcastRoom(room);
    }
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    const s = sessions.get(sessionId);
    const room = s?.roomCode ? rooms.get(s.roomCode) : null;
    if (room) {
      const p = room.players.find(x => x.sessionId === sessionId);
      if (p) p.connected = false;
      broadcastRoom(room);
      // cleanup disconnected empty rooms after 10 min
      setTimeout(() => {
        const r = rooms.get(room.code);
        if (r && r.players.every(x => !x.connected)) {
          endTimer(r);
          rooms.delete(room.code);
          io.emit("publicRooms", getRoomList());
        }
      }, 10 * 60 * 1000);
    }
  });
});

server.listen(PORT, () => console.log(`DrawBattle running on http://localhost:${PORT}`));
