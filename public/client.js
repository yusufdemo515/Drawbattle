const socket = io();

const avatarSeeds = [];
const reactions = ["🔥 Masterpiece","😂 What is this","😭 Bro tried","👀 Sus","⭐ Michelin Art","🌀 Confusing"];
const funTitles = ["Sketch King 👑","Chaos Artist 🎭","Potato Drawer 🥔","One Line Legend ✏️","Blindfold Picasso 🎨","Certified Scribbler 🌀","Cursed Creator 👻","Detail Demon 🔥"];

let sessionId = localStorage.getItem("drawbattleSessionId") || null;
let currentRoomCode = localStorage.getItem("drawbattleRoomCode") || "";
let screenHistory = ["home"];
let currentScreen = "home";
let profileId = localStorage.getItem("drawbattleProfileId") || null;
let userProfile = null;
let selectedSeed = localStorage.getItem("drawbattleSeed") || (window.COSMETICS?.freeAvatarIds?.[0] || "free_purple_glasses");
let shopTab = "avatars";
let gameMode = "Hard";
let roomState = null;
let votePage = 0;
let votedFor = "";
let tool = "pencil";
let color = "#111827";
let isDrawing = false;
let undoStack = [];
let redoStack = [];
let lastPoint = null;
let midPoint = null;
let currentZoomData = "";
let audioCtx = null;
let sfxEnabled = true;
let musicEnabled = true;
let sfxVol = 0.8;
let musicVol = 0.7;
let lastDrawSfx = 0;
let spinSfxId = null;
let spinSfxTimeout = null;
let sfxPack = localStorage.getItem("drawbattleSfxPack") || "cozy";
let sfxCooldowns = {};
let localTimerId = null;
let rewardNoticeKey = "";
const hostRevealedUnsafe = new Set();
let pendingInitialSetupGoRooms = false;

const COS = window.COSMETICS || {avatars:[],banners:[],decorations:[],freeAvatarIds:[],freeBannerIds:[]};
const allCosmetics = () => [...COS.avatars, ...COS.banners, ...COS.decorations];
const findCosmetic = id => allCosmetics().find(x => x.id === id);
const avatarUrl = id => findCosmetic(id)?.url || COS.avatars[0]?.url || `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(id||"Player")}&backgroundColor=ffffff,fef3c7,ffedd5,ffe4e6,e0f2fe,dcfce7,ede9fe&radius=50`;
const bannerCss = id => { const b=findCosmetic(id); return b?.color || (b?.url ? `url('${b.url}')` : "linear-gradient(135deg,#ffd6e8,#ffeff7)"); };
function decoratedAvatarHtml(avatarId, decoId="", cls="avatar-img"){
 const deco = decoId ? findCosmetic(decoId) : null;
 return `<span class="avatar-deco-wrap"><img class="${cls}" src="${avatarUrl(avatarId)}">${deco?`<img class="avatar-deco" src="${deco.url}">`:""}</span>`;
}

function lobbyPlayerCardHtml(p, actions=""){
 const banner = bannerCss(p.bannerId || "banner_free_pink");
 const level = p.level || 1;
 const role = p.host ? "Host" : "Player";
 const status = p.connected ? "Online" : "Reconnecting";
 return `<div class="player-row player-banner-row clickable-player" data-session="${p.sessionId}" onclick="openPublicProfile('${p.sessionId}')" title="View profile" style="background:${banner};background-size:cover;background-position:center">
  <div class="player-banner-overlay"></div>
  <div class="player-banner-content">
   ${decoratedAvatarHtml(p.avatarSeed,p.decoId)}
   <div class="player-meta safe">
    <div class="player-name-line"><b>${p.username}</b><span class="level-chip">Lv.${level}</span></div>
    <small>${role} • ${p.score} pts • ${status}</small>
   </div>
   <span class="dot" style="background:${p.connected?'#22c55e':'#f59e0b'}"></span>
   <div class="player-actions" onclick="event.stopPropagation()">${actions}</div>
  </div>
 </div>`;
}
function defaultProfile(){
 return {
  profileId: profileId || ("P-" + Math.random().toString(36).slice(2,10).toUpperCase()),
  username: localStorage.getItem("drawbattleUsername") || "",
  usernameNormalized: "",
  setupComplete: localStorage.getItem("drawbattleSetupComplete") === "1",
  usernameSetAt: Number(localStorage.getItem("drawbattleUsernameSetAt") || 0),
  lastUsernameChangeAt: Number(localStorage.getItem("drawbattleLastUsernameChangeAt") || 0),
  coins: 0, xp: 0, level: 1, wins: 0,
  owned: [...COS.freeAvatarIds, ...COS.freeBannerIds],
  avatarId: selectedSeed,
  bannerId: COS.freeBannerIds?.[0] || "banner_free_pink",
  decoId: ""
 };
}

async function handleFirebaseAuthChanged(user){
 try{
  if(!window.drawBattleFirebase?.enabled){ return; }
  if(!user){
   showToast("Guest mode active. Login to save progress in cloud.");
   renderProfilePage(); renderShop();
   return;
  }
  const local = userProfile || defaultProfile();
  const cloudProfile = await window.drawBattleFirebase.ensureCloudProfile(user, local);
  profileId = cloudProfile.profileId;
  localStorage.setItem("drawbattleProfileId", profileId);
  if(cloudProfile.username) localStorage.setItem("drawbattleUsername", cloudProfile.username);
  userProfile = cloudProfile;
  selectedSeed = cloudProfile.avatarId || selectedSeed;
  localStorage.setItem("drawbattleSeed", selectedSeed);
  if(username && !username.value && cloudProfile.username) username.value = cloudProfile.username;
  socket.emit("profileCloudSync", { profile: cloudProfile });
  socket.emit("profileLogin", { profileId, username: cloudProfile.username || user.displayName || "" });
  renderAvatars(); renderProfilePage(); renderShop();
  showToast("✅ Firebase login connected");
 }catch(e){
  console.error("Firebase auth profile load failed", e);
  showToast("Firebase profile load failed. Check Firestore rules.");
 }
}
window.handleFirebaseAuthChanged = handleFirebaseAuthChanged;

async function handleServerProfileData(profile){
 if(!profile) return;
 userProfile = profile;
 profileId = profile.profileId;
 localStorage.setItem("drawbattleProfileId", profileId);
 selectedSeed = profile.avatarId || selectedSeed;
 localStorage.setItem("drawbattleSeed", selectedSeed);
 if(profile.username) localStorage.setItem("drawbattleUsername", profile.username);
 if(profile.setupComplete) localStorage.setItem("drawbattleSetupComplete","1"); else localStorage.removeItem("drawbattleSetupComplete");
 if(profile.usernameSetAt) localStorage.setItem("drawbattleUsernameSetAt", String(profile.usernameSetAt));
 if(profile.lastUsernameChangeAt) localStorage.setItem("drawbattleLastUsernameChangeAt", String(profile.lastUsernameChangeAt));
 if(username && !profile.setupComplete) username.value = "";
 renderAvatars(); renderProfilePage(); renderShop();
 if(pendingInitialSetupGoRooms && profile.setupComplete){
  pendingInitialSetupGoRooms = false;
  go("rooms");
 }
 try{
  if(window.drawBattleFirebase?.user && profile.profileId === "fb_" + window.drawBattleFirebase.user.uid){
    await window.drawBattleFirebase.saveProfile(profile);
  }
 }catch(e){ console.warn("Cloud profile save failed", e); }
}

socket.emit("identify", { sessionId });

socket.on("session", ({ sessionId: sid }) => {
  sessionId = sid;
  localStorage.setItem("drawbattleSessionId", sid);
  if(window.drawBattleFirebase?.user){
    profileId = "fb_" + window.drawBattleFirebase.user.uid;
    localStorage.setItem("drawbattleProfileId", profileId);
    handleFirebaseAuthChanged(window.drawBattleFirebase.user);
  } else {
    if(!profileId){ profileId = "P-" + sid.slice(0,8).toUpperCase(); localStorage.setItem("drawbattleProfileId", profileId); }
    socket.emit("profileLogin", { profileId, username: localStorage.getItem("drawbattleUsername") || "" });
  }
});
socket.on("profileData", (profile) => handleServerProfileData(profile));
socket.on("shopError", msg => showToast("❌ " + msg));
socket.on("profileSetupError", msg => { pendingInitialSetupGoRooms = false; showToast("❌ " + msg); });
socket.on("publicRooms", renderPublicRooms);
socket.on("joinedRoom", ({ code }) => {
  currentRoomCode = code;
  localStorage.setItem("drawbattleRoomCode", code);
  go("lobby", false);
});
socket.on("roomState", state => {
  roomState = state;
  currentRoomCode = state.code;
  localStorage.setItem("drawbattleRoomCode", state.code);
  applyRoomState();
});
socket.on("chat", chat => renderChatList(chat));
socket.on("notice", showToast);
socket.on("errorMsg", msg => showToast("❌ " + msg));
socket.on("kicked", (data) => {
  showToast(data?.message || "You have been kicked by the host.");
  currentRoomCode = "";
  localStorage.removeItem("drawbattleRoomCode");
  roomState = null;
  go("create", false);
});

socket.on("leftRoom", () => {
  currentRoomCode = "";
  localStorage.removeItem("drawbattleRoomCode");
  roomState = null;
  showToast("You left the room.");
  go("rooms", false);
});

// Private canvas: no live remote drawing strokes are displayed.
socket.on("reaction", ({ targetSessionId, reaction }) => showReaction(targetSessionId, reaction));

function profileReady(){ const p=userProfile || defaultProfile(); return !!(p.setupComplete && p.username); }
function startGameFlow(){ if(profileReady()) go("rooms"); else go("avatar"); }
function go(id, pushHistory = true) {
  if (currentScreen === "intro" && id !== "intro") stopSpinSfx();
  if ((id === "rooms" || id === "create") && !validateProfile()) return;
  if (id === "avatar" && profileReady()) { go("rooms", pushHistory); return; }
  if (pushHistory && id !== currentScreen) {
    screenHistory.push(currentScreen);
    if (screenHistory.length > 25) screenHistory.shift();
  }
  currentScreen = id;
  document.querySelectorAll(".screen").forEach(s => { s.classList.remove("active"); s.style.display = "none"; });
  const target = document.getElementById(id);
  target.classList.add("active");
  target.style.display = "block";
  if (id === "draw") setupCanvas();
  if (id === "profile") renderProfilePage();
  if (id === "shop") renderShop();
  if (id === "avatar") renderAvatars();
  scrollTo(0,0);
}

function goBack() {
  // If user is inside a room lobby and presses Back, officially leave room.
  if (currentScreen === "lobby" && currentRoomCode) {
    if (confirm("Leave this room?")) {
      socket.emit("leaveRoom", { code: currentRoomCode });
    }
    return;
  }

  // During an active game, don't accidentally leave. Go back to lobby view only.
  if (currentScreen === "draw" || currentScreen === "vote" || currentScreen === "intro" || currentScreen === "results") {
    go("lobby", false);
    return;
  }

  let previous = screenHistory.pop() || "home";
  if (currentScreen === "create") previous = "rooms";
  if (currentScreen === "rooms") previous = profileReady() ? "home" : "avatar";
  if (currentScreen === "avatar") previous = "home";
  go(previous, false);
}

window.addEventListener("popstate", () => goBack());

function toggleSettings(){settingsPanel.classList.toggle("active");aboutPanel.classList.remove("active")}
function toggleAbout(){aboutPanel.classList.toggle("active");settingsPanel.classList.remove("active")}
function setTheme(t){
 const themes={cozy:["#fff7df","#fde047","#f9a8d4"],sky:["#eaf4ff","#93c5fd","#bae6fd"],candy:["#ffeef6","#f9a8d4","#f0abfc"],mint:["#e9fff4","#86efac","#a7f3d0"],paper:["#f8ead2","#fbbf24","#f5b971"],lavender:["#f1edff","#c4b5fd","#ddd6fe"]};
 const v=themes[t];document.documentElement.style.setProperty("--page",v[0]);document.documentElement.style.setProperty("--accent",v[1]);document.documentElement.style.setProperty("--accent2",v[2]);
}

function getAudio(){
 if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
 if(audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
 return audioCtx;
}
function safeNow(){ try{return getAudio().currentTime}catch(e){return 0} }
function rateLimit(key, ms){
 const now = performance.now();
 if(sfxCooldowns[key] && now - sfxCooldowns[key] < ms) return true;
 sfxCooldowns[key] = now;
 return false;
}
function tone(freq=440,duration=.08,type="sine",vol=.25,delay=0){
 if(!sfxEnabled) return;
 const ctx=getAudio(),osc=ctx.createOscillator(),gain=ctx.createGain();
 const t=ctx.currentTime+delay;
 osc.type=type;osc.frequency.setValueAtTime(freq,t);
 gain.gain.setValueAtTime(0,t);
 gain.gain.linearRampToValueAtTime(Math.max(.0001,vol*sfxVol),t+.012);
 gain.gain.exponentialRampToValueAtTime(.001,t+duration);
 osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+duration+.04);
}
function sweep(from=220,to=440,duration=.18,type="sine",vol=.14,delay=0){
 if(!sfxEnabled) return;
 const ctx=getAudio(),osc=ctx.createOscillator(),gain=ctx.createGain();
 const t=ctx.currentTime+delay;
 osc.type=type;osc.frequency.setValueAtTime(from,t);osc.frequency.exponentialRampToValueAtTime(Math.max(1,to),t+duration);
 gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(vol*sfxVol,t+.015);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
 osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+duration+.04);
}
function noise(duration=.12,vol=.15,filterFreq=1800){
 if(!sfxEnabled) return;
 const ctx=getAudio(),buffer=ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*duration)),ctx.sampleRate),data=buffer.getChannelData(0);
 for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(1-i/data.length);
 const src=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
 filter.type="lowpass"; filter.frequency.value=filterFreq;
 gain.gain.value=vol*sfxVol;src.buffer=buffer;src.connect(filter);filter.connect(gain);gain.connect(ctx.destination);src.start();
}
function playSfx(name){
 if(!sfxEnabled) return;
 try{
  if(name === "spin" && rateLimit("spin", 260)) return;
  if(name === "draw" && rateLimit("draw", 85)) return;
  if(name === "type" && rateLimit("type", 95)) return;
  const pack = sfxPack || "cozy";
  if(pack === "cozy") playCozySfx(name);
  else if(pack === "arcade") playArcadeSfx(name);
  else playMemeSfx(name);
 }catch(e){}
}
function playCozySfx(name){
 if(name==="click"){tone(520,.045,"triangle",.08);tone(720,.05,"triangle",.055,.035)}
 if(name==="start"){tone(392,.08,"sine",.10);tone(523,.10,"sine",.11,.08);tone(659,.13,"triangle",.10,.18)}
 if(name==="count"){tone(470,.07,"sine",.12)}
 if(name==="reveal"){tone(660,.10,"triangle",.11);tone(880,.14,"triangle",.10,.10);tone(1100,.18,"triangle",.08,.22)}
 if(name==="submit"){tone(587,.07,"triangle",.11);tone(784,.11,"triangle",.09,.08)}
 if(name==="vote"){tone(880,.08,"sine",.11);tone(1175,.10,"sine",.08,.07)}
 if(name==="zoom"){sweep(260,480,.12,"sine",.07)}
 if(name==="next"){tone(440,.06,"triangle",.08);tone(660,.08,"triangle",.07,.06)}
 if(name==="win"){tone(523,.12,"triangle",.11);tone(659,.12,"triangle",.10,.12);tone(784,.18,"triangle",.10,.24);noise(.22,.035,2600)}
 if(name==="erase"){noise(.055,.035,2200)}
 if(name==="bucket"){sweep(240,160,.14,"sine",.08);noise(.09,.035,1200)}
 if(name==="chat"){tone(760,.035,"triangle",.055);tone(980,.04,"triangle",.045,.025)}
 if(name==="type"){tone(540,.022,"sine",.025)}
 if(name==="draw"){noise(.032,.012,3200)}
 if(name==="spin"){sweep(260,520,.15,"triangle",.045);tone(740,.04,"sine",.03,.11)}
 if(name==="reaction"){tone(620,.05,"triangle",.08);tone(820,.07,"triangle",.065,.04)}
}
function playArcadeSfx(name){
 if(name==="click"){tone(740,.035,"square",.08);tone(980,.045,"square",.07,.03)}
 if(name==="start"){tone(330,.07,"square",.10);tone(494,.07,"square",.10,.07);tone(659,.10,"square",.10,.14)}
 if(name==="count"){tone(620,.06,"square",.13)}
 if(name==="reveal"){sweep(280,980,.22,"sawtooth",.09);tone(1180,.08,"square",.06,.20)}
 if(name==="submit"){tone(660,.055,"square",.09);tone(990,.07,"square",.08,.06)}
 if(name==="vote"){sweep(520,980,.10,"square",.075);tone(1260,.06,"square",.06,.09)}
 if(name==="zoom"){sweep(180,520,.11,"sawtooth",.07)}
 if(name==="next"){tone(520,.05,"square",.08);tone(780,.07,"square",.08,.05)}
 if(name==="win"){[523,659,784,1046].forEach((f,i)=>tone(f,.10,"square",.08,i*.09));noise(.20,.05,3500)}
 if(name==="erase"){noise(.045,.04,2500)}
 if(name==="bucket"){sweep(180,90,.12,"sawtooth",.09);noise(.08,.05,900)}
 if(name==="chat"){tone(920,.03,"square",.05)}
 if(name==="type"){tone(700,.018,"square",.025)}
 if(name==="draw"){noise(.025,.010,3600)}
 if(name==="spin"){sweep(360,920,.14,"sawtooth",.045)}
 if(name==="reaction"){tone(850,.04,"square",.08);tone(1120,.05,"square",.06,.04)}
}
function playMemeSfx(name){
 if(name==="click"){tone(180,.05,"sawtooth",.09);tone(120,.06,"sawtooth",.06,.04)}
 if(name==="start"){sweep(120,420,.20,"sawtooth",.11);noise(.16,.045,1200)}
 if(name==="count"){tone(220,.07,"square",.12)}
 if(name==="reveal"){sweep(90,55,.30,"sawtooth",.14);noise(.18,.05,700)}
 if(name==="submit"){tone(300,.06,"triangle",.09);sweep(500,180,.12,"sine",.07,.05)}
 if(name==="vote"){tone(210,.08,"sawtooth",.11);tone(160,.12,"sawtooth",.075,.07)}
 if(name==="zoom"){sweep(440,120,.15,"sine",.08)}
 if(name==="next"){tone(260,.05,"square",.08);tone(190,.07,"square",.07,.04)}
 if(name==="win"){sweep(130,70,.25,"sawtooth",.12);tone(520,.08,"square",.08,.22);noise(.25,.055,900)}
 if(name==="erase"){noise(.055,.04,1800)}
 if(name==="bucket"){sweep(260,80,.18,"sawtooth",.10);noise(.12,.05,600)}
 if(name==="chat"){tone(180,.045,"triangle",.07)}
 if(name==="type"){tone(300,.018,"square",.025)}
 if(name==="draw"){noise(.03,.011,2600)}
 if(name==="spin"){sweep(140,280,.16,"sawtooth",.045)}
 if(name==="reaction"){sweep(380,140,.10,"sawtooth",.09)}
}
function startSpinSfxLoop(){
 if(spinSfxId) return;
 playSfx("spin");
 spinSfxId = setInterval(()=>playSfx("spin"), 340);
 clearTimeout(spinSfxTimeout);
 spinSfxTimeout = setTimeout(stopSpinSfx, 3600);
}
function stopSpinSfx(){
 if(spinSfxId){ clearInterval(spinSfxId); spinSfxId=null; }
 if(spinSfxTimeout){ clearTimeout(spinSfxTimeout); spinSfxTimeout=null; }
}
document.addEventListener("visibilitychange",()=>{ if(document.hidden) stopSpinSfx(); });
window.addEventListener("blur", stopSpinSfx);
document.addEventListener("click", e => { if(e.target.closest("button")){ playSfx("click"); startBgMusic(); }}, true);
function startBgMusic(){ if(!bgMusic || !musicEnabled) return; bgMusic.volume=musicVol; bgMusic.play().catch(()=>{}); }
document.addEventListener("pointerdown", startBgMusic, {once:true});
document.addEventListener("keydown", startBgMusic, {once:true});
function toggleSfx(btn){sfxEnabled=!sfxEnabled;btn.textContent=sfxEnabled?"ON":"OFF";if(!sfxEnabled)stopSpinSfx();if(sfxEnabled)playSfx("click")}
function toggleMusic(btn){musicEnabled=!musicEnabled;btn.textContent=musicEnabled?"ON":"OFF"; if(musicEnabled) startBgMusic(); else bgMusic.pause();}
function setSfxPack(pack){
 sfxPack = pack;
 localStorage.setItem("drawbattleSfxPack", pack);
 updateSfxPackButtons();
 playSfx("reveal");
 showToast(`SFX Pack: ${pack[0].toUpperCase()+pack.slice(1)}`);
}
function updateSfxPackButtons(){
 document.querySelectorAll(".sfx-pack-option").forEach(btn=>btn.classList.toggle("active", btn.dataset.pack===sfxPack));
}
setTimeout(updateSfxPackButtons, 300);

function showToast(msg){
 toast.textContent=msg;toast.classList.add("show");
 setTimeout(()=>toast.classList.remove("show"),2400);
}

function renderAvatars(){
 const prof = userProfile || defaultProfile();
 const owned = new Set(prof.owned || []);
 const ownedAvatars = COS.avatars.filter(a => owned.has(a.id));
 selectedSeed = prof.avatarId || selectedSeed || ownedAvatars[0]?.id;
 avatarGrid.innerHTML = ownedAvatars.map(a => `<button class="avatar-card ${a.id===selectedSeed?'selected':''}" onclick="selectAvatar('${a.id}')"><img class="avatar-img" src="${a.url}"><div class="small">${a.name}</div></button>`).join("");
}
function selectAvatar(seed){
 selectedSeed=seed; localStorage.setItem("drawbattleSeed", seed);
 if(userProfile){ userProfile.avatarId=seed; socket.emit("equipItem", { profileId:userProfile.profileId, itemId:seed }); }
 renderAvatars(); renderProfilePage();
}

function validateProfile(){
 const p = userProfile || defaultProfile();
 if(!p.profileId){
  showToast("❌ Profile loading. Try again.");
  return false;
 }
 if(!p.setupComplete || !p.username){
  showToast("❌ Set your username first.");
  go("avatar");
  return false;
 }
 return true;
}
function completeInitialSetup(){
 const p = userProfile || defaultProfile();
 const u = username.value.trim();
 if(!u){ showToast("❌ Username required."); return; }
 selectedSeed = selectedSeed || p.avatarId || COS.freeAvatarIds?.[0] || "free_purple_glasses";
 pendingInitialSetupGoRooms = true;
 socket.emit("profileSetup", { profileId: p.profileId, username: u, avatarId: selectedSeed });
}
function validateProfileAndGoRooms(){ completeInitialSetup(); }
function validateRoomName(silent=true){
 const name=roomName.value.trim();
 if(!name) return true;
 return true;
}

function setMode(m){gameMode=m;modePick.textContent="Selected: "+m}
function createRoom(){
 if(!validateProfile()) return;
 const p = userProfile || defaultProfile();
 const name = roomName.value.trim() || `${p.username}'s Drawing Room`;
 socket.emit("createRoom", {
  username: p.username,
  avatarSeed: p.avatarId || selectedSeed,
  profileId: p.profileId || profileId,
  bannerId: p.bannerId || "banner_free_pink",
  decoId: p.decoId || "",
  roomName: name,
  type: roomType.value,
  settings: { slots: slots.value, timer: timer.value, rounds: rounds.value, mode: gameMode }
 });
}
function joinRoomByCode(){
 if(!validateProfile()) return;
 const p = userProfile || defaultProfile();
 socket.emit("joinRoom", { code: joinCode.value.trim(), username: p.username, avatarSeed: p.avatarId || selectedSeed, profileId: p.profileId || profileId, bannerId: p.bannerId || "banner_free_pink", decoId: p.decoId || "" });
}
function copyInvite(){
 navigator.clipboard?.writeText(currentRoomCode);
 showToast("Invite code copied: " + currentRoomCode);
}
function updateHostSettings(){
 if(!roomState || !isMeHost()) return;
 socket.emit("updateSettings", {
  code: currentRoomCode,
  name: lobbyName.textContent,
  type: roomState.type,
  settings: { slots: lobbySlots.value, timer: lobbyTimer.value, rounds: lobbyRounds.value, mode: lobbyMode.value, roomMode: lobbyRoomMode.value }
 });
}
function startGame(){ stopSpinSfx(); playSfx("start"); socket.emit("startGame", { code: currentRoomCode }); }
function finishVotingHost(){ socket.emit("finishVoting", { code: currentRoomCode }); }
function playAgainLobby(){ votedFor=""; votePage=0; go("lobby", false); }

function isMeHost(){ return roomState?.players?.some(p => p.sessionId === sessionId && p.host); }
function me(){ return roomState?.players?.find(p => p.sessionId === sessionId); }

function applyRoomState(){
 if(!roomState) return;
 const phase = roomState.phase;
 if(phase === "lobby") renderLobby();
 if(phase === "intro") renderIntro();
 if(phase === "draw") renderDraw();
 if(phase === "vote") renderVote();
 if(phase === "roundResults") renderRoundResults();
 if(phase === "results") renderResults();
}

function renderPublicRooms(rooms){
 if(!publicRooms) return;
 if(!rooms.length){ publicRooms.innerHTML = `<div class="field"><b>No public rooms yet.</b></div>`; return; }
 publicRooms.innerHTML = rooms.map(r => `<div class="room-row"><div class="safe-wrap"><b>${r.name}</b><br><small>${r.players}/${r.slots} players • ${r.roomMode || "Classic"} • ${r.mode} • ${r.phase}</small></div><button onclick="joinPublic('${r.code}')">Join</button></div>`).join("");
}
function joinPublic(code){ joinCode.value = code; joinRoomByCode(); }

function renderLobby(){
 stopSpinSfx();
 go("lobby", false);
 const settings = roomState.settings || {};
 lobbyName.textContent = roomState.name;
 roomPrivacy.innerHTML = roomState.type === "Private Room" ? "<b>Private code hidden. Copy invite code only.</b>" : "<b>Public room visible in room list.</b>";
 playerCount.textContent = `${roomState.players.length}/${settings.slots}`;
 slotInfo.textContent = `${roomState.players.length}/${settings.slots}`;
 timerInfo.textContent = Math.round((settings.timer || 180)/60)+" min";
 roundInfo.textContent = settings.rounds || 4;
 modeInfo.textContent = `${settings.roomMode || "Classic"} • ${settings.mode || "Normal"}`;
 if(roomModeInfo) roomModeInfo.textContent = settings.roomMode || "Classic";
 lobbySlots.value = settings.slots;
 lobbyTimer.value = settings.timer;
 lobbyRounds.value = settings.rounds;
 lobbyMode.value = settings.mode || "Normal";
 if(lobbyRoomMode) lobbyRoomMode.value = settings.roomMode || "Classic";
 document.querySelectorAll(".host-only").forEach(el => el.style.display = isMeHost() ? "" : "none");
 playerList.innerHTML = roomState.players.map(p => {
  const canKick = isMeHost() && p.sessionId !== sessionId;
  const actions = `${canKick?`<button class="report-btn" onclick="kick('${p.sessionId}')">Kick</button>`:""}`;
  return lobbyPlayerCardHtml(p, actions);
 }).join("");
 if(lobbyEmoteBar){ lobbyEmoteBar.innerHTML = ["😂","🔥","💀","😭","👀"].map(e=>`<button onclick="sendLobbyEmote('${e}')">${e}</button>`).join(""); }
 renderChatList(roomState.chat || []);
}
function kick(id){ socket.emit("kick", { code: currentRoomCode, targetSessionId: id }); }
function reportPlayer(id){ socket.emit("report", { code: currentRoomCode, targetSessionId: id }); showToast("Report sent."); }
function sendLobbyEmote(e){ if(!currentRoomCode) return; playSfx("reaction"); socket.emit("lobbyEmote", { code: currentRoomCode, emote:e }); }
function showLobbyEmote(sid, emote){
 const card=document.querySelector(`.player-row[data-session="${sid}"]`);
 if(!card) return;
 const pop=document.createElement("div");
 pop.className="lobby-emote-pop";
 pop.textContent=emote;
 card.appendChild(pop);
 setTimeout(()=>pop.remove(),1100);
}

function renderIntro(){
 stopSpinSfx();
 go("intro", false);
 introRound.textContent = `${roomState.round}/${roomState.totalRounds}`;
 const msLeft = Math.max(0, roomState.timerEndsAt - Date.now());
 countdownNum.style.display = "block";
 slotBox.style.display = "none";
 promptReveal.style.display = "none";
 introTitle.textContent = "Game starting in";
 introHint.textContent = "Get ready...";
 clearInterval(localTimerId);
 let n = Math.max(1, Math.ceil(msLeft/1000));
 countdownNum.textContent = Math.min(5,n);
 localTimerId = setInterval(() => {
  const left = Math.max(0, roomState.timerEndsAt - Date.now());
  const sec = Math.ceil(left/1000);
  if(sec > 2){ countdownNum.textContent = Math.min(5,sec-2); playSfx("count"); }
  else {
   countdownNum.style.display = "none";
   introTitle.textContent = "Choosing drawing name...";
   slotBox.style.display = "block";
   slotBlur.style.display = "block";
   promptReveal.style.display = "none";
   introHint.textContent = "Random object is spinning...";
   startSpinSfxLoop();
  }
  if(left <= 500){
   clearInterval(localTimerId);
   stopSpinSfx();
  }
 }, 500);
}

function renderDraw(){
 stopSpinSfx();
 go("draw", false);
 roundNow.textContent = roomState.round;
 drawRounds.textContent = roomState.totalRounds;
 const mode = roomState.settings?.roomMode || "Classic";
 promptBox.textContent = "✏️ " + roomState.currentPrompt.toUpperCase();
 if(drawModeBadge) drawModeBadge.textContent = mode;
 setupCanvas();
 applyRoomModeTools(mode);
 startLocalTimer(drawTimer, () => {});
 renderChatList(roomState.chat || []);
}
function startLocalTimer(el, done){
 clearInterval(localTimerId);
 const tick=()=>{ 
  const left=Math.max(0, roomState.timerEndsAt-Date.now());
  el.textContent = `${String(Math.floor(left/60000)).padStart(2,"0")}:${String(Math.floor((left%60000)/1000)).padStart(2,"0")}`;
  if(currentScreen==="draw" && roomState?.settings?.roomMode==="Blind Draw"){
    document.body.classList.toggle("blind-draw-active", left <= 10000 && left > 0);
  } else document.body.classList.remove("blind-draw-active");
  if(left<=0){clearInterval(localTimerId); document.body.classList.remove("blind-draw-active"); done&&done();}
 };
 tick(); localTimerId=setInterval(tick,500);
}


function applyRoomModeTools(mode){
 document.body.classList.toggle("mobile-canvas-focus", false);
 if(noEraserNote) noEraserNote.style.display = (mode === "No Eraser") ? "block" : "none";
 if(blindNote) blindNote.style.display = (mode === "Blind Draw") ? "block" : "none";
 if(eraserBtn) eraserBtn.disabled = mode === "No Eraser";
 if(mode === "One Color"){
   if(!oneColorLocked){
     const cs=["#111827","#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899"];
     oneColorLocked = cs[Math.floor(Math.random()*cs.length)];
   }
   color = oneColorLocked;
   renderColors();
   if(oneColorNote) { oneColorNote.style.display="block"; oneColorNote.textContent="One Color Mode: locked color"; }
 } else {
   oneColorLocked = "";
   if(oneColorNote) oneColorNote.style.display="none";
 }
}
function toggleCanvasFullscreen(){
 document.body.classList.toggle("mobile-canvas-focus");
}

function setupCanvas(){
 const canvas=drawCanvas, ctx=canvas.getContext("2d");
 ctx.lineCap="round"; ctx.lineJoin="round";
 if(!canvas.dataset.ready){
  clearCanvas(false);
  canvas.onpointerdown=e=>{
   canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
   const p=pos(e);
   if(tool==='bucket'){playSfx('bucket'); saveState(); floodFill(Math.floor(p.x),Math.floor(p.y),hexToRgba(color)); return;}
   isDrawing=true; saveState(); redoStack=[]; lastPoint=p; midPoint=p; ctx.beginPath(); ctx.moveTo(p.x,p.y);
  };
  canvas.onpointermove=e=>{
   if(!isDrawing || !lastPoint) return;
   const p=pos(e); const mid={x:(lastPoint.x+p.x)/2,y:(lastPoint.y+p.y)/2};
   ctx.globalCompositeOperation=tool==="eraser"?"destination-out":"source-over";
   const now=performance.now(); if(now-lastDrawSfx>95){playSfx(tool==="eraser"?"erase":"draw"); lastDrawSfx=now;}
   ctx.strokeStyle=color; ctx.globalAlpha=tool==="marker"?.55:1;
   const base=Number(brushSize.value);
   ctx.lineWidth=tool==="pen"?Math.max(2,base*.55):tool==="sketch"?base*1.15:tool==="marker"?base*1.65:base;
   ctx.beginPath(); ctx.moveTo(midPoint.x,midPoint.y); ctx.quadraticCurveTo(lastPoint.x,lastPoint.y,mid.x,mid.y); ctx.stroke();
   if(tool==="sketch"){ctx.globalAlpha=.16;ctx.beginPath();ctx.moveTo(midPoint.x+Math.random()*3,midPoint.y+Math.random()*3);ctx.quadraticCurveTo(lastPoint.x+Math.random()*5-2.5,lastPoint.y+Math.random()*5-2.5,mid.x,mid.y);ctx.stroke();}
   ctx.globalAlpha=1; midPoint=mid; lastPoint=p;
   // Private drawing: do not send live strokes to other players.
   // Drawing image is sent only when Submit is clicked.
  };
  const stop=e=>{isDrawing=false;lastPoint=null;midPoint=null;try{canvas.releasePointerCapture&&canvas.releasePointerCapture(e.pointerId)}catch(_){}};
  canvas.onpointerup=stop; canvas.onpointercancel=stop; canvas.onpointerleave=stop;
  canvas.dataset.ready="true";
 }
 if(roomState?.phase === "draw" && !window._canvasForRound || window._canvasForRound !== roomState.round){
  window._canvasForRound = roomState.round;
  undoStack=[]; redoStack=[]; clearCanvas(false); saveState();
 }
}
function drawRemoteStroke(stroke){ /* private canvas mode: disabled */ }
function pos(e){const r=drawCanvas.getBoundingClientRect();return{x:(e.clientX-r.left)*drawCanvas.width/r.width,y:(e.clientY-r.top)*drawCanvas.height/r.height}}
function saveState(){try{undoStack.push(drawCanvas.toDataURL());if(undoStack.length>25)undoStack.shift()}catch(e){}}
function restore(data){const img=new Image();img.onload=()=>{const ctx=drawCanvas.getContext("2d");ctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);ctx.drawImage(img,0,0)};img.src=data}
function undo(){if(undoStack.length>1){redoStack.push(undoStack.pop());restore(undoStack[undoStack.length-1])}}
function redo(){if(redoStack.length){const d=redoStack.pop();undoStack.push(d);restore(d)}}
function clearCanvas(save=true){playSfx('erase');const ctx=drawCanvas.getContext("2d");ctx.globalCompositeOperation="source-over";ctx.fillStyle="#fff";ctx.fillRect(0,0,drawCanvas.width,drawCanvas.height);if(save)saveState()}
function setTool(t){ if(roomState?.settings?.roomMode==="No Eraser" && t==="eraser"){showToast("No Eraser Mode enabled.");return;} tool=t;document.querySelectorAll('.tool').forEach(b=>b.classList.remove('tool-selected','active')); if(toolSelect){ if(['pencil','pen','sketch','marker'].includes(t)){toolSelect.value=t;toolSelect.classList.add('selected')} else toolSelect.classList.remove('selected'); } if(t==='eraser') eraserBtn.classList.add('tool-selected'); if(t==='bucket') bucketBtn.classList.add('tool-selected');}
function renderColors(){
 let cs=["#111827","#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#ffffff","#78350f","#94a3b8"];
 if(roomState?.settings?.roomMode==="One Color" && oneColorLocked) cs=[oneColorLocked];
 colors.innerHTML=cs.map(c=>`<span class="color ${c===color?'active':''}" style="background:${c}" onclick="${roomState?.settings?.roomMode==='One Color'?'showToast(\'One Color Mode locked.\')':`color='${c}';renderColors()`}"></span>`).join("");
}
function submitDrawing(){ playSfx("submit"); socket.emit("submitDrawing", { code: currentRoomCode, image: drawCanvas.toDataURL("image/png") }); showToast("Drawing submitted."); }

function hexToRgba(hex){hex=hex.replace("#","");if(hex.length===3)hex=hex.split("").map(c=>c+c).join("");return[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255]}
function floodFill(startX,startY,fill){
 const canvas=drawCanvas,ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height,img=ctx.getImageData(0,0,w,h),data=img.data;
 const idx=(startY*w+startX)*4,target=[data[idx],data[idx+1],data[idx+2],data[idx+3]],tol=28;
 const same=i=>Math.abs(data[i]-target[0])<=tol&&Math.abs(data[i+1]-target[1])<=tol&&Math.abs(data[i+2]-target[2])<=tol&&Math.abs(data[i+3]-target[3])<=tol;
 const stack=[[startX,startY]],seen=new Uint8Array(w*h);let count=0,limit=w*h*.65;
 while(stack.length){const [x,y]=stack.pop();if(x<0||y<0||x>=w||y>=h)continue;const p=y*w+x;if(seen[p])continue;seen[p]=1;const i=p*4;if(!same(i))continue;data[i]=fill[0];data[i+1]=fill[1];data[i+2]=fill[2];data[i+3]=255;count++;if(count>limit)break;stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
 ctx.putImageData(img,0,0);
}

function renderVote(){
 stopSpinSfx();
 go("vote", false);
 voteRound.textContent=roomState.round; voteRounds.textContent=roomState.totalRounds;
 startLocalTimer(voteTimer,()=>{});
 renderVoteCards();
 renderChatList(roomState.chat || []);
}
function renderVoteCards(){
 const drawings=roomState.drawings || [];
 const start=votePage*3, visible=drawings.slice(start,start+3), pages=Math.max(1,Math.ceil(drawings.length/3));
 const host = isMeHost();
 voteCards.innerHTML=visible.map((d,i)=>{
  const img=d.image || makeBlankDrawing(d.username);
  const isUnsafe = !!d.unsafe;
  const hostCanSee = host && hostRevealedUnsafe.has(d.sessionId);
  const blurClass = isUnsafe && !hostCanSee ? " unsafe-blurred" : "";
  const showBtn = isUnsafe && host ? `<button class="zoom-btn show-unsafe-btn" onclick="toggleUnsafeReveal('${d.sessionId}')">${hostCanSee?'Hide':'Show me'}</button>` : "";
  const reportBtn = host && d.sessionId!==sessionId ? `<button class="reaction-btn" onclick="reportUnsafeDrawing('${d.sessionId}')">🚩 Report image</button>` : "";
  const accuracy = d.accuracyScore ? `<small class="accuracy-chip">Detector +${d.accuracyScore} pts</small>` : "";
  return `<div class="vote-card" data-session="${d.sessionId}"><div class="drawing-preview${blurClass}"><button class="zoom-btn" onclick="openZoom('${d.username}',${start+i+1},'${img}')">🔍 Zoom</button>${showBtn}<img src="${img}">${isUnsafe && !hostCanSee?`<div class="unsafe-cover"><b>Blurred safety image</b><small>Adult/illegal report</small></div>`:""}</div><div class="player-row" style="box-shadow:none;border:0">${decoratedAvatarHtml(d.avatarSeed,d.decoId)}<div><b>${d.username}</b><br><small>${d.afk?'AFK auto-skip':'Votes hidden'}</small><br>${accuracy}</div></div><div class="reaction-row">${reactions.map(r=>`<button class="reaction-btn" onclick="sendReaction(this,'${d.sessionId}','${r.replace(/'/g,"")}')">${r}</button>`).join("")}${reportBtn}</div><button style="width:100%;margin-top:10px" ${d.sessionId===sessionId?'disabled':''} onclick="castVote('${d.sessionId}',this)">${votedFor===d.sessionId?'VOTED':'VOTE'}</button></div>`;
 }).join("");
 voteDots.innerHTML=Array.from({length:pages}).map((_,i)=>`<span class="dot-page ${i===votePage?'active':''}"></span>`).join("");
 showingText.textContent=`Showing ${drawings.length?start+1:0}–${Math.min(start+3,drawings.length)} of ${drawings.length}`;
 finishVoteBtn.style.display = isMeHost() ? "" : "none";
 finishVoteBtn.textContent = "Finish Voting Early";
}
function toggleUnsafeReveal(id){ if(!isMeHost()) return; if(hostRevealedUnsafe.has(id)) hostRevealedUnsafe.delete(id); else hostRevealedUnsafe.add(id); renderVoteCards(); }
function reportUnsafeDrawing(id){ if(!isMeHost()){ showToast('Only host can report images.'); return; } socket.emit("reportUnsafeDrawing", { code: currentRoomCode, targetSessionId: id }); showToast('Image reported. Blurred for non-host players.'); }
function makeBlankDrawing(name){
 const c=document.createElement("canvas");c.width=900;c.height=604;const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#cbd5e1";ctx.font="bold 46px Trebuchet MS";ctx.fillText("AFK / Blank",320,280);ctx.font="bold 30px Trebuchet MS";ctx.fillText(name,380,340);return c.toDataURL("image/png");
}
function nextVote(){votePage=(votePage+1)%Math.max(1,Math.ceil((roomState.drawings||[]).length/3));renderVoteCards()}
function prevVote(){votePage=(votePage-1+Math.max(1,Math.ceil((roomState.drawings||[]).length/3)))%Math.max(1,Math.ceil((roomState.drawings||[]).length/3));renderVoteCards()}
function castVote(id,btn){playSfx("vote");votedFor=id;socket.emit("vote",{code:currentRoomCode,targetSessionId:id});renderVoteCards()}
function sendReaction(btn,targetSessionId,reaction){playSfx("reaction");btn.classList.add("active");setTimeout(()=>btn.classList.remove("active"),700);socket.emit("reaction",{code:currentRoomCode,targetSessionId,reaction});showReaction(targetSessionId,reaction)}
function showReaction(targetSessionId,reaction){const card=document.querySelector(`.vote-card[data-session="${targetSessionId}"]`);if(!card)return;const pop=document.createElement("div");pop.className="reaction-pop";pop.textContent=reaction.split(" ")[0];card.appendChild(pop);setTimeout(()=>pop.remove(),900)}
function finishVotingHost(){ socket.emit("finishVoting", { code: currentRoomCode }); }
function playAgainLobby(){ votedFor=""; votePage=0; go("lobby", false); }

function renderRoundResults(){
 roundScore.style.display="block";
 roundScore.innerHTML=`Round ${roomState.round} points added. Next round starting...`;
 go("vote", false);
 renderVoteCards();
}

function renderResults(){
 stopSpinSfx();
 go("results", false);
 playSfx("win");
 const ranking=[...roomState.players].sort((a,b)=>b.score-a.score);
 winnerTitle.textContent=funTitles[Math.floor(Math.random()*funTitles.length)];
 podium.innerHTML=[["2",ranking[1],"height:150px;background:#e5e7eb"],["1",ranking[0],"height:210px;background:var(--accent)"],["3",ranking[2],"height:120px;background:#e5e7eb"]].filter(x=>x[1]).map(p=>`<div>${decoratedAvatarHtml(p[1].avatarSeed,p[1].decoId)}<h3 class="safe">${p[1].username}</h3><b>${p[1].score} pts</b><div class="bar" style="${p[2]}">#${p[0]}</div></div>`).join("");
 const resultTitles=["Sketch King 👑","Chaos Artist 😂","Bro Tried Award 😭","Most Confusing Drawing 🌀","Cleanest Artist ✨","Speed Scribbler ⚡","No Eraser Survivor 💀","One Color Legend 🎨"];
 mvpCards.innerHTML=ranking.map((p,i)=>`<div class="mvp-card"><h3>${resultTitles[i%resultTitles.length]}</h3>${decoratedAvatarHtml(p.avatarSeed,p.decoId)}<div><b>${p.username}</b></div><small>${p.score} pts</small></div>`).join("");
 finalList.innerHTML=ranking.map((p,i)=>`<div class="player-row clickable-player" onclick="openPublicProfile('${p.sessionId}')">${decoratedAvatarHtml(p.avatarSeed,p.decoId)}<b>#${i+1} ${p.username}</b><span style="margin-left:auto;font-weight:1000">${p.score} pts</span></div>`).join("");
 if(roomState.rewards && roomState.rewards[sessionId]){
  const r = roomState.rewards[sessionId];
  const key = `${currentRoomCode}-${roomState.round}-${r.place}-${r.coins}-${r.xp}`;
  if(rewardNoticeKey !== key){
    rewardNoticeKey = key;
    showToast(`Reward: +${r.coins} coins, +${r.xp} XP`);
    socket.emit("getProfile", { profileId: userProfile?.profileId || profileId });
  }
}
 launchConfetti();
}
function launchConfetti(){confettiLayer.innerHTML='';const colors=['#fde047','#f9a8d4','#93c5fd','#86efac','#c4b5fd','#fb7185'];for(let i=0;i<42;i++){const s=document.createElement('span');s.className='confetti-piece';s.style.left=Math.random()*100+'%';s.style.top='-40px';s.style.background=colors[i%colors.length];s.style.animationDelay=(Math.random()*1.6)+'s';s.style.animationDuration=(2.2+Math.random()*1.4)+'s';confettiLayer.appendChild(s)}setTimeout(()=>confettiLayer.innerHTML='',4200)}

function renderChatList(chat=[]){
 const html=chat.map(m=>`<div class="chat-msg"><img class="chat-avatar" src="${avatarUrl(m.avatarSeed)}"><div><b>${m.username}</b><p>${m.message}</p></div></div>`).join("");
 [lobbyChat, sketchChat, voteChat].forEach(box=>{ if(box){ box.innerHTML=html; box.scrollTop=box.scrollHeight; }});
}
function playTypeSfx(){const now=performance.now();if(!window._lastTypeSfx||now-window._lastTypeSfx>120){playSfx("type");window._lastTypeSfx=now}}
document.addEventListener("input", e=>{ if(["lobbyMsg","drawMsg","voteMsg"].includes(e.target.id)) playTypeSfx(); });
function sendChat(inputId){const inp=document.getElementById(inputId);const message=inp.value.trim();if(!message)return;playSfx("chat");socket.emit("chat",{code:currentRoomCode,message});inp.value=""}

function openZoom(name,num,img){playSfx("zoom");currentZoomData=img;zoomTitle.textContent=`${name}'s Drawing #${num}`;zoomImg.src=img;zoomModal.classList.add("active")}
function closeZoom(){zoomModal.classList.remove("active")}
function downloadZoomDrawing(){if(!currentZoomData)return;const a=document.createElement("a");a.href=currentZoomData;a.download="drawbattle-drawing.png";a.click();showToast("⬇ Drawing downloaded")}



function openPublicProfile(targetSessionId){
 const p = roomState?.players?.find(x => x.sessionId === targetSessionId);
 if(!p || !publicProfileModal || !publicProfileContent) return;
 playSfx("zoom");
 const banner = bannerCss(p.bannerId || "banner_free_pink");
 const av = findCosmetic(p.avatarSeed);
 const de = p.decoId ? findCosmetic(p.decoId) : null;
 const bn = findCosmetic(p.bannerId);
 const safeName = (p.username || "Player").replace(/[<>]/g, "");
 publicProfileContent.innerHTML = `
  <div class="public-profile-banner" style="background:${banner};background-size:cover;background-position:center">
   <div class="public-profile-overlay"></div>
   <div class="public-profile-avatar">${decoratedAvatarHtml(p.avatarSeed,p.decoId,'avatar-img public-profile-avatar-img')}</div>
  </div>
  <div class="public-profile-body">
   <div class="row-wrap">
    <div><h2>${safeName}</h2><div class="small"><b>${p.host ? "Room Host" : "Player"}</b> • ${p.connected ? "Online" : "Reconnecting"}</div></div>
    <span class="pill level-pill">⭐ Lv.${p.level || 1}</span>
   </div>
   <div class="public-stats-grid">
    <div class="setting-box"><small>Match Score</small><b>${p.score || 0}</b></div>
    <div class="setting-box"><small>Total Wins</small><b>${p.wins || 0}</b></div>
    <div class="setting-box"><small>Matches</small><b>${p.matches || 0}</b></div>
    <div class="setting-box"><small>XP</small><b>${p.xp || 0}</b></div>
   </div>
   <div class="public-equipped-line">
    <b>Equipped:</b> ${av?.name || "Default Avatar"} • ${bn?.name || "Default Banner"} • ${de?.name || "No Decoration"}
   </div>
   <p class="small"><b>Coins and owned inventory are private.</b></p>
  </div>`;
 publicProfileModal.classList.add("active");
}
function closePublicProfile(){ if(publicProfileModal) publicProfileModal.classList.remove("active"); }


function refreshFriends(){ const p=userProfile||defaultProfile(); if(p.profileId) socket.emit("getFriends",{profileId:p.profileId}); }
function openFriendsModal(){ refreshFriends(); friendsModal.classList.add("active"); }
function closeFriendsModal(){ friendsModal.classList.remove("active"); }
function claimDailyReward(){ const p=userProfile||defaultProfile(); socket.emit("claimDaily",{profileId:p.profileId}); }
function sendFriendRequestUi(){
 const p=userProfile||defaultProfile();
 const u=(friendUsernameInput?.value || friendUsernameInputModal?.value || "").trim();
 if(!u){showToast("Enter username.");return;}
 socket.emit("sendFriendRequest",{profileId:p.profileId, username:u});
}
function acceptFriend(id){ const p=userProfile||defaultProfile(); socket.emit("respondFriendRequest",{profileId:p.profileId, fromProfileId:id, accept:true}); }
function declineFriend(id){ const p=userProfile||defaultProfile(); socket.emit("respondFriendRequest",{profileId:p.profileId, fromProfileId:id, accept:false}); }
function removeFriend(id){ const p=userProfile||defaultProfile(); socket.emit("removeFriend",{profileId:p.profileId, friendProfileId:id}); }
function renderFriendsPanel(){
 const target = friendsList || document.getElementById("friendsModalList");
 if(!target) return;
 const req = (friendsState.requestsIn||[]).map(f=>`<div class="friend-card">${decoratedAvatarHtml(f.avatarId,f.decoId)}<div><b>${f.username}</b><br><small>Lv.${f.level} wants to be friends</small></div><div class="friend-actions"><button onclick="acceptFriend('${f.profileId}')">Accept</button><button class="report-btn" onclick="declineFriend('${f.profileId}')">Decline</button></div></div>`).join("");
 const friends = (friendsState.friends||[]).map(f=>`<div class="friend-card">${decoratedAvatarHtml(f.avatarId,f.decoId)}<div><b>${f.username}</b><br><small>Lv.${f.level} • ${f.wins} wins</small></div><div class="friend-actions"><button onclick="inviteFriend('${f.profileId}')">Invite</button><button onclick="joinFriendPublic('${f.profileId}')">Join</button></div></div>`).join("");
 const out = (friendsState.requestsOut||[]).map(f=>`<span class="pill">Pending: ${f.username}</span>`).join(" ");
 const html = `${req?`<h3>Requests</h3>${req}`:""}<h3>Friends</h3>${friends || '<div class="field"><b>No friends yet.</b></div>'}${out?`<h3>Pending</h3>${out}`:""}`;
 target.innerHTML = html;
 if(window.friendsModalList && target !== friendsModalList) friendsModalList.innerHTML = html;
}
function inviteFriend(id){ if(!currentRoomCode){showToast("Create/join a room first.");return;} navigator.clipboard?.writeText(`${location.origin} • Room ${currentRoomCode}`); showToast("Invite copied for friend."); }
function joinFriendPublic(id){ showToast("Friend public-room join works from Public Rooms list for now."); go("rooms"); }

function renderProfilePage(){
 const p = userProfile || defaultProfile();
 if(username && !username.value && p.username) username.value = p.username;
 if(profileName) profileName.textContent = (p.username || "Player") + " ✨";
 if(profileCoins) profileCoins.textContent = "🪙 " + (p.coins||0) + " coins";
 if(profileLevel) profileLevel.textContent = "⭐ Lv." + (p.level||1);
 if(profileWins) profileWins.textContent = p.wins || 0;
 if(profileXp) profileXp.textContent = p.xp || 0;
 if(profileOwned) profileOwned.textContent = (p.owned||[]).length;
 if(shopCoinBadge) shopCoinBadge.textContent = "🪙 " + (p.coins||0) + " coins";
 const av=findCosmetic(p.avatarId)||COS.avatars[0], de=p.decoId?findCosmetic(p.decoId):null, bn=findCosmetic(p.bannerId);
 if(profileAvatar) profileAvatar.src = avatarUrl(p.avatarId);
 if(profileDeco){ if(de){ profileDeco.src=de.url; profileDeco.style.display="block"; } else profileDeco.style.display="none"; }
 if(profileBanner){ profileBanner.style.background = bannerCss(p.bannerId); profileBanner.style.backgroundSize="cover"; profileBanner.style.backgroundPosition="center"; }
 if(equippedLine) equippedLine.textContent = `Avatar: ${av?.name||"Free"} • Banner: ${bn?.name||"Plain Pink"} • Decoration: ${de?.name||"None"}`;
 if(profileBadges) profileBadges.innerHTML = (p.badges||[]).map(b=>`<span class="pill badge-pill">${b}</span>`).join(" ") || '<span class="small">No badges yet.</span>';
 if(dailyRewardInfo) dailyRewardInfo.textContent = `Daily streak: ${p.daily?.streak || 0}`;

 if(profileUsernameInput) profileUsernameInput.value = p.username || "";
 if(profileUsernameHelp){
  const left = usernameChangeLeftDays(p);
  profileUsernameHelp.textContent = !p.setupComplete ? "Set username first from Start Game." : left > 0 ? `You can change name after ${left} day${left===1?"":"s"}.` : "You can change your username now.";
 }
 if(profileUsernameBtn){
  profileUsernameBtn.disabled = !p.setupComplete || usernameChangeLeftDays(p) > 0;
  profileUsernameBtn.textContent = usernameChangeLeftDays(p) > 0 ? "Locked" : "Change Username";
 }
 if(currentScreen === "profile") refreshFriends();
}
function usernameChangeLeftDays(p){
 const last = Number(p?.lastUsernameChangeAt || 0);
 if(!last) return 0;
 const left = (15*24*60*60*1000) - (Date.now() - last);
 return Math.max(0, Math.ceil(left/(24*60*60*1000)));
}
function openUsernameModal(){ renderProfilePage(); usernameModal.classList.add("active"); }
function closeUsernameModal(){ usernameModal.classList.remove("active"); }
function changeProfileUsername(){
 const p = userProfile || defaultProfile();
 const u = profileUsernameInput?.value?.trim();
 if(!u){ showToast("❌ Username required."); return; }
 socket.emit("profileUsernameChange", { profileId: p.profileId, username: u });
 closeUsernameModal();
}
function setShopTab(tab, btn){ shopTab=tab; document.querySelectorAll('.shop-tab').forEach(b=>b.classList.remove('active')); if(btn)btn.classList.add('active'); renderShop(); }
function renderShop(){
 const p = userProfile || defaultProfile();
 if(shopCoinBadge) shopCoinBadge.textContent = "🪙 " + (p.coins||0) + " coins";
 if(!shopGrid) return;
 const owned = new Set(p.owned || []);
 const list = shopTab==='avatars' ? COS.avatars : shopTab==='banners' ? COS.banners : COS.decorations;
 shopGrid.innerHTML = list.map(it=>{
  const isOwned = owned.has(it.id);
  const equipped = p.avatarId===it.id || p.bannerId===it.id || p.decoId===it.id;
  let preview = '';
  if(it.kind==='avatar') preview = `<img class="avatar-img shop-avatar" src="${it.url}">`;
  if(it.kind==='banner') preview = `<div class="shop-banner-preview" style="background:${it.color || `url('${it.url}')`};background-size:cover;background-position:center"></div>`;
  if(it.kind==='deco') preview = `<div class="shop-deco-preview">${decoratedAvatarHtml(p.avatarId,it.id,'avatar-img shop-avatar')}</div>`;
  let label = 'Buy';
  if(isOwned && equipped && it.kind==='deco') label='Unequip';
  else if(isOwned && equipped) label='Equipped';
  else if(isOwned) label='Equip';
  return `<div class="shop-item">${preview}<h3>${it.name}</h3><div class="price-pill">${isOwned?'Owned':'🪙 '+it.price}</div><button onclick="shopAction('${it.id}')">${label}</button></div>`;
 }).join('');
}
function shopAction(itemId){
 const p = userProfile || defaultProfile();
 const it = findCosmetic(itemId); if(!it) return;
 if(p.owned?.includes(itemId) && it.kind==='deco' && p.decoId===itemId){ socket.emit('equipItem', { profileId:p.profileId, itemId }); return; }
 if(p.owned?.includes(itemId)){ socket.emit('equipItem', { profileId:p.profileId, itemId }); return; }
 socket.emit('buyItem', { profileId:p.profileId, itemId });
}

renderAvatars();
renderColors();
setTimeout(()=>setTool("pencil"),0);
if(currentRoomCode) showToast("Reconnect ready. Join your last room if still active.");
