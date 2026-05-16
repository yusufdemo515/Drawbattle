# DrawBattle Multiplayer

A complete Node.js + Socket.IO multiplayer drawing battle game.

## Features
- Create / join rooms with room code
- Public room list
- Host settings before starting
- Reconnect system via saved session ID
- Real-time chat with bad-word filter
- Real-time canvas strokes
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

## Notes
This is a functional multiplayer build, but before public launch you should later add:
- persistent database
- stronger moderation/admin dashboard
- rate limiting
- production logging
- HTTPS deployment
