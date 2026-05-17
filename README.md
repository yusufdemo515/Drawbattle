# DrawBattle Multiplayer

A complete Node.js + Socket.IO multiplayer drawing battle game.

## Features
- Create / join rooms with room code
- Public room list
- Host settings before starting
- Reconnect system via saved session ID
- Real-time chat with bad-word filter
- Private drawing canvas: drawings show only after submit
- Drawing tools: pencil, pen, sketch, marker, eraser, bucket fill
- Rounds, timers, random prompt reveal animation
- Voting with hidden votes
- Reaction stickers under drawings
- MVP cards + funny final titles
- Winner crown/confetti effects
- Kick/report safety
- AFK auto-blank drawing if player does not submit
- Mobile responsive layout
- Download final drawing from zoom preview
- Background music loop from `public/assets/drawbattle.mp3`
- Login/profile system with saved username/avatar/banner/decoration
- Coins, XP, levels and win stats
- Shop system: avatars, banners, avatar decorations
- Buy/equip/unequip logic
- Match reward system: 1st/2nd/3rd coin rewards and XP progress

## Run locally

Install Node.js 18+ first.

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

For testing multiplayer on same Wi-Fi, open with your PC LAN IP:

```text
http://YOUR_PC_IP:3000
```

Example:

```text
http://192.168.1.10:3000
```

## Deploy

You can deploy this to Render/Railway/Fly.io. Make sure WebSocket support is enabled.

Start command:

```bash
npm start
```

Port:

```text
3000 or process.env.PORT
```

## Profile / Coins Storage

This build saves profiles on the server in:

```text
data/profiles.json
```

On Render free, persistent disk is limited, so for long-term public launch you should move profile data to Firebase/Firestore. Firebase setup files are included:

```text
FIREBASE_SETUP.md
firebase.json
firestore.rules
firestore.indexes.json
```

## Notes
This is a functional multiplayer build, but before public launch you should later add:
- Firebase/Firestore production connection
- stronger moderation/admin dashboard
- rate limiting
- production logging
- HTTPS deployment


## Latest Update
- Lobby/final player cards can be clicked to view public profile.
- Public profile shows banner, avatar decoration, level, XP, wins, matches, match score.
- Coins and owned inventory remain private.


## Latest gameplay fixes
- Host Kick button restored on non-host player cards.
- Host can start a new match again after final results.
- Game start now requires minimum 2 connected players.
- Prompt pool expanded from the provided 1000+ object/name list.
- Drawing safety report added: reported adult/illegal images are blurred for normal players; host can use Show me/Hide locally.
- Detector hook added: current local detector rewards drawing effort only. True apple-vs-apple semantic AI needs a real vision AI/moderation service key later.
