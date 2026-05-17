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

const PROMPTS = {
  Normal: ["Dragon","Castle","Robot","Pirate Ship","Katana","Crown","UFO","Dinosaur","Knight","Guitar","Burger","Zombie","Phoenix","Spaceship","Skull","Tank","Wizard","Treasure Chest","Rocket","Monster","Camera","Backpack","Penguin","Volcano"],
  Medium: ["Cyber Dragon","Ancient Temple","Steam Train","Crystal Sword","Haunted Castle","Alien Robot","Golden Crown","Viking Ship","Magic Portal","Samurai Helmet","Lava Monster","Ice Dragon","Battle Axe","Space Station","Giant Spider","Demon Mask","Flying Car","Treasure Map","Jungle Ruins","Robot Dog"],
  Hard: ["Mechanical Phoenix","Gothic Cathedral","Cyber Samurai","Dragon Skull","Steampunk Airship","Crystal Golem","Ancient War Machine","Haunted Pirate Ship","Alien Mothership","Royal Battle Armor","Demonic Throne","Floating Island Castle","Laser Cannon Tank","Mythic Kraken","Fantasy Clock Tower","Space Dragon","Cursed Laboratory","Clockwork Dragon"]
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
function makeDefaultProfile(profileId, username = "") {
  return {
    profileId,
    username: cleanText(username, 24) || "Player",
    coins: 0,
    xp: 0,
    level: 1,
    wins: 0,
    matches: 0,
    owned: [...DEFAULT_OWNED],
    avatarId: COSMETICS.freeAvatarIds[0] || "free_purple_glasses",
    bannerId: COSMETICS.freeBannerIds[0] || "banner_free_pink",
    decoId: ""
  };
}
function getProfile(profileId, username = "") {
  profileId = cleanText(profileId, 40) || nanoid(12);
  if (!profiles[profileId]) { profiles[profileId] = makeDefaultProfile(profileId, username); saveProfiles(); }
  if (username && cleanText(username, 24)) profiles[profileId].username = cleanText(username, 24);
  return profiles[profileId];
}
function sanitizeProfile(p) {
  p.owned = Array.isArray(p.owned) ? [...new Set([...DEFAULT_OWNED, ...p.owned])] : [...DEFAULT_OWNED];
  if (!ITEM_MAP.has(p.avatarId)) p.avatarId = COSMETICS.freeAvatarIds[0];
  if (!ITEM_MAP.has(p.bannerId)) p.bannerId = COSMETICS.freeBannerIds[0];
  if (p.decoId && !ITEM_MAP.has(p.decoId)) p.decoId = "";
  p.matches = Math.max(0, Number(p.matches || 0));
  p.level = Math.max(1, Math.floor((p.xp || 0) / 250) + 1);
  return p;
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
      mode: settings.mode || "Hard"
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
    drawings: room.phase === "vote" || room.phase === "results"
      ? [...room.drawings.values()].map(d => ({ sessionId: d.sessionId, username: d.username, avatarSeed: d.avatarSeed, decoId: d.decoId || "", image: d.image, afk: d.afk || false }))
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
    room.timerEndsAt = Date.now() + room.settings.timer * 1000;
    broadcastRoom(room);
    room.timerHandle = setTimeout(() => startVoting(room), room.settings.timer * 1000 + 300);
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
        afk: true
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

  socket.on("getProfile", ({ profileId }) => {
    const profile = sanitizeProfile(getProfile(profileId));
    socket.emit("profileData", profile);
  });

  socket.on("profileUpdate", ({ profileId, username }) => {
    const profile = sanitizeProfile(getProfile(profileId, username));
    if (username && cleanText(username, 24)) profile.username = cleanText(username, 24);
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
    username = cleanText(username, 24);
    roomName = cleanText(roomName, 50);
    if (!username) return socket.emit("errorMsg", "Bad/empty username not allowed.");
    if (!roomName) roomName = `${username}'s Drawing Room`;
    type = type === "Public Room" ? "Public Room" : "Private Room";
    const room = makeRoom({ name: roomName, type, settings: settings || {} });
    const sessionId = socket.data.sessionId || nanoid(16);
    socket.data.sessionId = sessionId;
    room.hostSessionId = sessionId;
    const prof = profileId ? sanitizeProfile(getProfile(profileId, username)) : null;
    const owned = new Set(prof?.owned || []);
    avatarSeed = owned.has(avatarSeed) ? avatarSeed : (prof?.avatarId || COSMETICS.freeAvatarIds[0]);
    bannerId = owned.has(bannerId) ? bannerId : (prof?.bannerId || COSMETICS.freeBannerIds[0]);
    decoId = owned.has(decoId) ? decoId : (prof?.decoId || "");
    room.players.push({ sessionId, profileId: prof?.profileId || "", username, avatarSeed: avatarSeed || COSMETICS.freeAvatarIds[0], bannerId, decoId, level: prof?.level || 1, score: 0, connected: true, lastActive: Date.now() });
    rooms.set(room.code, room);
    sessions.set(sessionId, { socketId: socket.id, roomCode: room.code });
    socket.join(room.code);
    socket.emit("joinedRoom", { code: room.code });
    broadcastRoom(room);
  });

  socket.on("joinRoom", ({ code, username, avatarSeed, profileId, bannerId, decoId }) => {
    username = cleanText(username, 24);
    if (!username) return socket.emit("errorMsg", "Bad/empty username not allowed.");
    code = String(code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMsg", "Room not found.");
    if (room.players.length >= room.settings.slots) return socket.emit("errorMsg", "Room is full.");
    if (room.phase !== "lobby") return socket.emit("errorMsg", "Game already started.");
    const sessionId = socket.data.sessionId || nanoid(16);
    socket.data.sessionId = sessionId;
    let player = room.players.find(p => p.sessionId === sessionId);
    const prof = profileId ? sanitizeProfile(getProfile(profileId, username)) : null;
    const owned = new Set(prof?.owned || []);
    avatarSeed = owned.has(avatarSeed) ? avatarSeed : (prof?.avatarId || COSMETICS.freeAvatarIds[0]);
    bannerId = owned.has(bannerId) ? bannerId : (prof?.bannerId || COSMETICS.freeBannerIds[0]);
    decoId = owned.has(decoId) ? decoId : (prof?.decoId || "");
    if (!player) {
      player = { sessionId, profileId: prof?.profileId || "", username, avatarSeed: avatarSeed || COSMETICS.freeAvatarIds[0], bannerId, decoId, level: prof?.level || 1, score: 0, connected: true, lastActive: Date.now() };
      room.players.push(player);
    } else {
      player.connected = true;
      player.profileId = prof?.profileId || player.profileId || "";
      player.username = username;
      player.avatarSeed = avatarSeed || player.avatarSeed;
      player.bannerId = bannerId || player.bannerId;
      player.decoId = decoId || player.decoId || "";
      player.level = prof?.level || player.level || 1;
    }
    sessions.set(sessionId, { socketId: socket.id, roomCode: room.code });
    socket.join(room.code);
    socket.emit("joinedRoom", { code: room.code });
    broadcastRoom(room);
  });

  socket.on("updateSettings", ({ code, settings, name, type }) => {
    const room = rooms.get(code);
    if (!isHost(socket, room) || room.phase !== "lobby") return;
    if (cleanText(name, 50)) room.name = cleanText(name, 50);
    if (type === "Public Room" || type === "Private Room") room.type = type;
    room.settings = {
      slots: Number(settings?.slots || room.settings.slots),
      timer: Number(settings?.timer || room.settings.timer),
      rounds: Number(settings?.rounds || room.settings.rounds),
      mode: ["Normal","Medium","Hard"].includes(settings?.mode) ? settings.mode : room.settings.mode
    };
    broadcastRoom(room);
  });

  socket.on("startGame", ({ code }) => {
    const room = rooms.get(code);
    if (!isHost(socket, room) || room.phase !== "lobby") return;
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
    room.drawings.set(player.sessionId, {
      sessionId: player.sessionId,
      username: player.username,
      avatarSeed: player.avatarSeed,
      decoId: player.decoId || "",
      image: typeof image === "string" && image.length < 6_000_000 ? image : null
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
