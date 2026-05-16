const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

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
      ? [...room.drawings.values()].map(d => ({ sessionId: d.sessionId, username: d.username, avatarSeed: d.avatarSeed, image: d.image }))
      : [],
    reactionCounts: room.reactionCounts
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
      broadcastRoom(room);
    } else {
      startRound(room);
    }
  }, 4200);
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

  socket.on("createRoom", ({ username, avatarSeed, roomName, type, settings }) => {
    username = cleanText(username, 24);
    roomName = cleanText(roomName, 50);
    if (!username) return socket.emit("errorMsg", "Bad/empty username not allowed.");
    if (!roomName) roomName = `${username}'s Drawing Room`;
    type = type === "Public Room" ? "Public Room" : "Private Room";
    const room = makeRoom({ name: roomName, type, settings: settings || {} });
    const sessionId = socket.data.sessionId || nanoid(16);
    socket.data.sessionId = sessionId;
    room.hostSessionId = sessionId;
    room.players.push({ sessionId, username, avatarSeed: avatarSeed || "Aarav", score: 0, connected: true, lastActive: Date.now() });
    rooms.set(room.code, room);
    sessions.set(sessionId, { socketId: socket.id, roomCode: room.code });
    socket.join(room.code);
    socket.emit("joinedRoom", { code: room.code });
    broadcastRoom(room);
  });

  socket.on("joinRoom", ({ code, username, avatarSeed }) => {
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
    if (!player) {
      player = { sessionId, username, avatarSeed: avatarSeed || "Aarav", score: 0, connected: true, lastActive: Date.now() };
      room.players.push(player);
    } else {
      player.connected = true;
      player.username = username;
      player.avatarSeed = avatarSeed || player.avatarSeed;
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
