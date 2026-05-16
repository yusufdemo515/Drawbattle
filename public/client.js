const socket = io();

const avatarSeeds = ["Aarav","Kabir","Rohan","Zayan","Aisha","Maya","Sara","Nora","Rehan","Arjun","Vihaan","Ishaan","Riya","Meera","Anaya","Zoya"];
const reactions = ["🔥 Masterpiece","😂 What is this","😭 Bro tried","👀 Sus","⭐ Michelin Art","🌀 Confusing"];
const funTitles = ["Sketch King 👑","Chaos Artist 🎭","Potato Drawer 🥔","One Line Legend ✏️","Blindfold Picasso 🎨","Certified Scribbler 🌀","Cursed Creator 👻","Detail Demon 🔥"];

let sessionId = localStorage.getItem("drawbattleSessionId") || null;
let currentRoomCode = localStorage.getItem("drawbattleRoomCode") || "";
let screenHistory = ["home"];
let currentScreen = "home";
let selectedSeed = localStorage.getItem("drawbattleSeed") || "Aarav";
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
let localTimerId = null;

const avatarUrl = s => `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(s)}&backgroundColor=ffffff,fef3c7,ffedd5,ffe4e6,e0f2fe,dcfce7,ede9fe&radius=50`;

socket.emit("identify", { sessionId });

socket.on("session", ({ sessionId: sid }) => {
  sessionId = sid;
  localStorage.setItem("drawbattleSessionId", sid);
});
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
socket.on("kicked", () => { showToast("You were kicked by host."); currentRoomCode=""; go("rooms"); });
socket.on("stroke", ({ stroke }) => drawRemoteStroke(stroke));
socket.on("reaction", ({ targetSessionId, reaction }) => showReaction(targetSessionId, reaction));

function go(id, pushHistory = true) {
  if (id === "rooms" && !validateProfile()) return;
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
  scrollTo(0,0);
}

function goBack() {
  let previous = screenHistory.pop() || "home";

  // During active game, don't accidentally leave server room; just move UI back safely.
  if (currentScreen === "draw" || currentScreen === "vote" || currentScreen === "intro" || currentScreen === "results") {
    previous = "lobby";
  }

  if (currentScreen === "create") previous = "rooms";
  if (currentScreen === "rooms") previous = "avatar";
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

function getAudio(){ if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
function tone(freq=440,duration=.08,type="sine",vol=.25,delay=0){
 if(!sfxEnabled) return;
 const ctx=getAudio(),osc=ctx.createOscillator(),gain=ctx.createGain();
 osc.type=type;osc.frequency.setValueAtTime(freq,ctx.currentTime+delay);
 gain.gain.setValueAtTime(0,ctx.currentTime+delay);gain.gain.linearRampToValueAtTime(vol*sfxVol,ctx.currentTime+delay+.01);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+delay+duration);
 osc.connect(gain);gain.connect(ctx.destination);osc.start(ctx.currentTime+delay);osc.stop(ctx.currentTime+delay+duration+.02);
}
function noise(duration=.12,vol=.15){
 if(!sfxEnabled) return;
 const ctx=getAudio(),buffer=ctx.createBuffer(1,ctx.sampleRate*duration,ctx.sampleRate),data=buffer.getChannelData(0);
 for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(1-i/data.length);
 const src=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=vol*sfxVol;src.buffer=buffer;src.connect(gain);gain.connect(ctx.destination);src.start();
}
function playSfx(name){
 if(!sfxEnabled) return;
 try{
  if(name==="click"){tone(520,.05,"triangle",.12);tone(720,.05,"triangle",.09,.04)}
  if(name==="start"){tone(392,.09,"square",.13);tone(523,.09,"square",.13,.09);tone(659,.12,"square",.13,.18)}
  if(name==="count"){tone(460,.08,"sine",.18)}
  if(name==="reveal"){tone(660,.09,"triangle",.16);tone(880,.12,"triangle",.16,.08);tone(1100,.16,"triangle",.14,.17)}
  if(name==="submit"){tone(587,.08,"triangle",.16);tone(784,.12,"triangle",.16,.09)}
  if(name==="vote"){tone(700,.06,"sine",.14);tone(930,.08,"sine",.14,.06)}
  if(name==="zoom"){tone(300,.06,"sine",.1);tone(520,.1,"sine",.12,.05)}
  if(name==="next"){tone(440,.06,"square",.1);tone(660,.08,"square",.1,.06)}
  if(name==="win"){tone(523,.12,"triangle",.15);tone(659,.12,"triangle",.15,.12);tone(784,.18,"triangle",.16,.24);tone(1046,.25,"triangle",.14,.42)}
  if(name==="erase"){noise(.06,.055)}
  if(name==="bucket"){tone(220,.1,"sawtooth",.12);noise(.12,.07)}
  if(name==="chat"){tone(760,.035,"triangle",.075);tone(980,.04,"triangle",.055,.025)}
  if(name==="type"){tone(540,.025,"sine",.035)}
  if(name==="draw"){noise(.035,.018)}
  if(name==="spin"){tone(180,.04,"sawtooth",.055);tone(240,.035,"sawtooth",.045,.035)}
  if(name==="reaction"){tone(620,.05,"triangle",.12);tone(820,.07,"triangle",.1,.04)}
 }catch(e){}
}
document.addEventListener("click", e => { if(e.target.closest("button")){ playSfx("click"); startBgMusic(); }}, true);
function startBgMusic(){ if(!bgMusic || !musicEnabled) return; bgMusic.volume=musicVol; bgMusic.play().catch(()=>{}); }
document.addEventListener("pointerdown", startBgMusic, {once:true});
document.addEventListener("keydown", startBgMusic, {once:true});
function toggleSfx(btn){sfxEnabled=!sfxEnabled;btn.textContent=sfxEnabled?"ON":"OFF";if(sfxEnabled)playSfx("click")}
function toggleMusic(btn){musicEnabled=!musicEnabled;btn.textContent=musicEnabled?"ON":"OFF"; if(musicEnabled) startBgMusic(); else bgMusic.pause();}

function showToast(msg){
 toast.textContent=msg;toast.classList.add("show");
 setTimeout(()=>toast.classList.remove("show"),2400);
}

function renderAvatars(){
 avatarGrid.innerHTML = avatarSeeds.map(s => `<button class="avatar-card ${s===selectedSeed?'selected':''}" onclick="selectAvatar('${s}')"><img class="avatar-img" src="${avatarUrl(s)}"><div class="small">${s}</div></button>`).join("");
}
function selectAvatar(seed){ selectedSeed=seed; localStorage.setItem("drawbattleSeed", seed); renderAvatars(); }

function validateProfile(){
 const u = username.value.trim();
 if(!u){ showToast("❌ Username required."); return false; }
 return true;
}
function validateProfileAndGoRooms(){ if(validateProfile()) go("rooms"); }
function validateRoomName(silent=true){
 const name=roomName.value.trim();
 if(!name) return true;
 return true;
}

function setMode(m){gameMode=m;modePick.textContent="Selected: "+m}
function createRoom(){
 if(!validateProfile()) return;
 const name = roomName.value.trim() || `${username.value.trim()}'s Drawing Room`;
 socket.emit("createRoom", {
  username: username.value.trim(),
  avatarSeed: selectedSeed,
  roomName: name,
  type: roomType.value,
  settings: { slots: slots.value, timer: timer.value, rounds: rounds.value, mode: gameMode }
 });
}
function joinRoomByCode(){
 if(!validateProfile()) return;
 socket.emit("joinRoom", { code: joinCode.value.trim(), username: username.value.trim(), avatarSeed: selectedSeed });
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
  settings: { slots: lobbySlots.value, timer: lobbyTimer.value, rounds: lobbyRounds.value, mode: lobbyMode.value }
 });
}
function startGame(){ playSfx("start"); socket.emit("startGame", { code: currentRoomCode }); }
function finishVotingHost(){ socket.emit("finishVoting", { code: currentRoomCode }); }

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
 publicRooms.innerHTML = rooms.map(r => `<div class="room-row"><div class="safe-wrap"><b>${r.name}</b><br><small>${r.players}/${r.slots} players • ${r.mode} • ${r.phase}</small></div><button onclick="joinPublic('${r.code}')">Join</button></div>`).join("");
}
function joinPublic(code){ joinCode.value = code; joinRoomByCode(); }

function renderLobby(){
 go("lobby", false);
 lobbyName.textContent = roomState.name;
 roomPrivacy.innerHTML = roomState.type === "Private Room" ? "<b>Private code hidden. Copy invite code only.</b>" : "<b>Public room visible in room list.</b>";
 playerCount.textContent = `${roomState.players.length}/${roomState.settings.slots}`;
 slotInfo.textContent = `${roomState.players.length}/${roomState.settings.slots}`;
 timerInfo.textContent = Math.round(roomState.settings.timer/60)+" min";
 roundInfo.textContent = roomState.settings.rounds;
 modeInfo.textContent = roomState.settings.mode;
 lobbySlots.value = roomState.settings.slots;
 lobbyTimer.value = roomState.settings.timer;
 lobbyRounds.value = roomState.settings.rounds;
 lobbyMode.value = roomState.settings.mode;
 document.querySelectorAll(".host-only").forEach(el => el.style.display = isMeHost() ? "" : "none");
 playerList.innerHTML = roomState.players.map(p => `<div class="player-row"><img src="${avatarUrl(p.avatarSeed)}"><div class="safe"><b>${p.username}</b><br><small>${p.host?'Host':'Player'} • ${p.score} pts ${p.connected?'':'• reconnecting'}</small></div><span class="dot" style="background:${p.connected?'#22c55e':'#f59e0b'}"></span>${!p.host && isMeHost()?`<button class="report-btn" onclick="kick('${p.sessionId}')">Kick</button>`:""}${!p.host?`<button class="report-btn" onclick="reportPlayer('${p.sessionId}')">Report</button>`:""}</div>`).join("");
 renderChatList(roomState.chat || []);
}
function kick(id){ socket.emit("kick", { code: currentRoomCode, targetSessionId: id }); }
function reportPlayer(id){ socket.emit("report", { code: currentRoomCode, targetSessionId: id }); showToast("Report sent."); }

function renderIntro(){
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
   if(!spinSfxId) spinSfxId=setInterval(()=>playSfx("spin"),120);
  }
  if(left <= 500){
   clearInterval(localTimerId);
   if(spinSfxId){clearInterval(spinSfxId);spinSfxId=null;}
  }
 }, 500);
}

function renderDraw(){
 go("draw", false);
 roundNow.textContent = roomState.round;
 drawRounds.textContent = roomState.totalRounds;
 promptBox.textContent = "✏️ " + roomState.currentPrompt.toUpperCase();
 setupCanvas();
 startLocalTimer(drawTimer, () => {});
 renderChatList(roomState.chat || []);
}
function startLocalTimer(el, done){
 clearInterval(localTimerId);
 const tick=()=>{ 
  const left=Math.max(0, roomState.timerEndsAt-Date.now());
  el.textContent = `${String(Math.floor(left/60000)).padStart(2,"0")}:${String(Math.floor((left%60000)/1000)).padStart(2,"0")}`;
  if(left<=0){clearInterval(localTimerId); done&&done();}
 };
 tick(); localTimerId=setInterval(tick,500);
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
   socket.emit("stroke", { code: currentRoomCode, stroke: { tool, color, size: Number(brushSize.value), from: midPoint, control: lastPoint, to: mid }});
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
function drawRemoteStroke(stroke){
 const ctx=drawCanvas.getContext("2d");
 ctx.globalCompositeOperation=stroke.tool==="eraser"?"destination-out":"source-over";
 ctx.strokeStyle=stroke.color; ctx.globalAlpha=stroke.tool==="marker"?.55:1;
 const base=Number(stroke.size||12);
 ctx.lineWidth=stroke.tool==="pen"?Math.max(2,base*.55):stroke.tool==="sketch"?base*1.15:stroke.tool==="marker"?base*1.65:base;
 ctx.beginPath(); ctx.moveTo(stroke.from.x,stroke.from.y); ctx.quadraticCurveTo(stroke.control.x,stroke.control.y,stroke.to.x,stroke.to.y); ctx.stroke(); ctx.globalAlpha=1;
}
function pos(e){const r=drawCanvas.getBoundingClientRect();return{x:(e.clientX-r.left)*drawCanvas.width/r.width,y:(e.clientY-r.top)*drawCanvas.height/r.height}}
function saveState(){try{undoStack.push(drawCanvas.toDataURL());if(undoStack.length>25)undoStack.shift()}catch(e){}}
function restore(data){const img=new Image();img.onload=()=>{const ctx=drawCanvas.getContext("2d");ctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);ctx.drawImage(img,0,0)};img.src=data}
function undo(){if(undoStack.length>1){redoStack.push(undoStack.pop());restore(undoStack[undoStack.length-1])}}
function redo(){if(redoStack.length){const d=redoStack.pop();undoStack.push(d);restore(d)}}
function clearCanvas(save=true){playSfx('erase');const ctx=drawCanvas.getContext("2d");ctx.globalCompositeOperation="source-over";ctx.fillStyle="#fff";ctx.fillRect(0,0,drawCanvas.width,drawCanvas.height);if(save)saveState()}
function setTool(t){tool=t;document.querySelectorAll('.tool').forEach(b=>b.classList.remove('tool-selected','active')); if(toolSelect){ if(['pencil','pen','sketch','marker'].includes(t)){toolSelect.value=t;toolSelect.classList.add('selected')} else toolSelect.classList.remove('selected'); } if(t==='eraser') eraserBtn.classList.add('tool-selected'); if(t==='bucket') bucketBtn.classList.add('tool-selected');}
function renderColors(){const cs=["#111827","#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#ffffff","#78350f","#94a3b8"];colors.innerHTML=cs.map(c=>`<span class="color ${c===color?'active':''}" style="background:${c}" onclick="color='${c}';renderColors()"></span>`).join("")}
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
 go("vote", false);
 voteRound.textContent=roomState.round; voteRounds.textContent=roomState.totalRounds;
 startLocalTimer(voteTimer,()=>{});
 renderVoteCards();
 renderChatList(roomState.chat || []);
}
function renderVoteCards(){
 const drawings=roomState.drawings || [];
 const start=votePage*3, visible=drawings.slice(start,start+3), pages=Math.max(1,Math.ceil(drawings.length/3));
 voteCards.innerHTML=visible.map((d,i)=>{
  const img=d.image || makeBlankDrawing(d.username);
  return `<div class="vote-card" data-session="${d.sessionId}"><div class="drawing-preview"><button class="zoom-btn" onclick="openZoom('${d.username}',${start+i+1},'${img}')">🔍 Zoom</button><img src="${img}"></div><div class="player-row" style="box-shadow:none;border:0"><img src="${avatarUrl(d.avatarSeed)}"><div><b>${d.username}</b><br><small>${d.afk?'AFK auto-skip':'Votes hidden'}</small></div></div><div class="reaction-row">${reactions.map(r=>`<button class="reaction-btn" onclick="sendReaction(this,'${d.sessionId}','${r.replace(/'/g,"")}')">${r}</button>`).join("")}</div><button style="width:100%;margin-top:10px" ${d.sessionId===sessionId?'disabled':''} onclick="castVote('${d.sessionId}',this)">${votedFor===d.sessionId?'VOTED':'VOTE'}</button></div>`;
 }).join("");
 voteDots.innerHTML=Array.from({length:pages}).map((_,i)=>`<span class="dot-page ${i===votePage?'active':''}"></span>`).join("");
 showingText.textContent=`Showing ${drawings.length?start+1:0}–${Math.min(start+3,drawings.length)} of ${drawings.length}`;
 finishVoteBtn.style.display = isMeHost() ? "" : "none";
}
function makeBlankDrawing(name){
 const c=document.createElement("canvas");c.width=900;c.height=604;const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#cbd5e1";ctx.font="bold 46px Trebuchet MS";ctx.fillText("AFK / Blank",320,280);ctx.font="bold 30px Trebuchet MS";ctx.fillText(name,380,340);return c.toDataURL("image/png");
}
function nextVote(){votePage=(votePage+1)%Math.max(1,Math.ceil((roomState.drawings||[]).length/3));renderVoteCards()}
function prevVote(){votePage=(votePage-1+Math.max(1,Math.ceil((roomState.drawings||[]).length/3)))%Math.max(1,Math.ceil((roomState.drawings||[]).length/3));renderVoteCards()}
function castVote(id,btn){playSfx("vote");votedFor=id;socket.emit("vote",{code:currentRoomCode,targetSessionId:id});renderVoteCards()}
function sendReaction(btn,targetSessionId,reaction){playSfx("reaction");btn.classList.add("active");setTimeout(()=>btn.classList.remove("active"),700);socket.emit("reaction",{code:currentRoomCode,targetSessionId,reaction});showReaction(targetSessionId,reaction)}
function showReaction(targetSessionId,reaction){const card=document.querySelector(`.vote-card[data-session="${targetSessionId}"]`);if(!card)return;const pop=document.createElement("div");pop.className="reaction-pop";pop.textContent=reaction.split(" ")[0];card.appendChild(pop);setTimeout(()=>pop.remove(),900)}
function finishVotingHost(){ socket.emit("finishVoting", { code: currentRoomCode }); }

function renderRoundResults(){
 roundScore.style.display="block";
 roundScore.innerHTML=`Round ${roomState.round} points added. Next round starting...`;
 go("vote", false);
 renderVoteCards();
}

function renderResults(){
 go("results", false);
 playSfx("win");
 const ranking=[...roomState.players].sort((a,b)=>b.score-a.score);
 winnerTitle.textContent=funTitles[Math.floor(Math.random()*funTitles.length)];
 podium.innerHTML=[["2",ranking[1],"height:150px;background:#e5e7eb"],["1",ranking[0],"height:210px;background:var(--accent)"],["3",ranking[2],"height:120px;background:#e5e7eb"]].filter(x=>x[1]).map(p=>`<div><img class="avatar-img" src="${avatarUrl(p[1].avatarSeed)}"><h3 class="safe">${p[1].username}</h3><b>${p[1].score} pts</b><div class="bar" style="${p[2]}">#${p[0]}</div></div>`).join("");
 const shuffled=[...ranking].sort(()=>Math.random()-.5);
 mvpCards.innerHTML=[["Most Funny Drawing 😂",shuffled[0]],["Most Cursed Art 👻",shuffled[1]||shuffled[0]],["Most Confusing 🌀",shuffled[2]||shuffled[0]]].map(m=>`<div class="mvp-card"><h3>${m[0]}</h3><img class="avatar-img" src="${avatarUrl(m[1].avatarSeed)}"><div><b>${m[1].username}</b></div></div>`).join("");
 finalList.innerHTML=ranking.map((p,i)=>`<div class="player-row"><img src="${avatarUrl(p.avatarSeed)}"><b>#${i+1} ${p.username}</b><span style="margin-left:auto;font-weight:1000">${p.score} pts</span></div>`).join("");
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

renderAvatars();
renderColors();
setTimeout(()=>setTool("pencil"),0);
if(currentRoomCode) showToast("Reconnect ready. Join your last room if still active.");
