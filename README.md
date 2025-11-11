# Discord Bot Dashboard - Backend API

Express.js backend API for Discord Server Manager Bot dashboard.

## 🚀 Features

- RESTful API endpoints
- Discord OAuth2 authentication
- Session management
- WebSocket support for real-time updates
- Prisma ORM integration
- CORS configured
- Health check endpoint

## 🛠️ Tech Stack

- **Express.js** - Web framework
- **TypeScript** - Type safety
- **Passport.js** - OAuth2 authentication
- **Prisma Client** - Database ORM
- **Socket.IO** - Real-time communication
- **express-session** - Session management

## 📦 Installation

```bash
npm install
```

## 🔧 Configuration

Create `.env` file:

```env
# Discord OAuth2
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_CALLBACK_URL=http://localhost:3001/auth/discord/callback

# Database
DATABASE_URL=mysql://user:password@host:3306/database

# Dashboard
DASHBOARD_URL=http://localhost:5173
DASHBOARD_API_PORT=3001

# Security
SESSION_SECRET=your_random_32_character_secret
```

## 🚀 Development

```bash
npm run dev:server
```

Server runs on: http://localhost:3001

## 🏗️ Build

```bash
npm run build:server
```

Output: `dist/server/` folder

## 📡 API Endpoints

### Authentication
- `GET /auth/discord` - Initiate Discord OAuth2
- `GET /auth/discord/callback` - OAuth callback
- `GET /auth/logout` - Logout user
- `GET /auth/user` - Get current user

### Guilds
- `GET /api/guilds` - Get user's guilds

### Guild Stats
- `GET /api/guild/:guildId/stats` - Guild statistics
- `GET /api/guild/:guildId/leaderboard?metric=points&limit=10` - Leaderboard
- `GET /api/guild/:guildId/activity?days=7` - Activity data
- `GET /api/guild/:guildId/user/:userId` - User profile

### WebSocket Events
- `subscribe:guild` - Subscribe to guild updates
- Real-time stats updates

## ☁️ Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Set environment variables (in Railway dashboard)

# Deploy
railway up

# Get URL
railway domain
```

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | MySQL connection string | Yes |
| `DISCORD_CLIENT_ID` | Discord OAuth2 client ID | Yes |
| `DISCORD_CLIENT_SECRET` | Discord OAuth2 secret | Yes |
| `DISCORD_CALLBACK_URL` | OAuth redirect URL | Yes |
| `DASHBOARD_URL` | Frontend URL | Yes |
| `DASHBOARD_API_PORT` | Port to run on | No (default: 3001) |
| `SESSION_SECRET` | Session encryption key | Yes |

## 🔒 Security

- Session cookies with httpOnly
- CORS restricted to dashboard domain
- OAuth2 state parameter validation
- Secure session secrets
- HTTPS only in production

## 📚 Files

- `server/index.ts` - Main server file
- `server/tsconfig.json` - TypeScript config
- `package.json` - Dependencies
- `railway.json` - Railway config
- `Procfile` - Process definition
- `wrangler.toml` - Cloudflare config (if using Workers)

## 🆘 Troubleshooting

### Cannot connect to database
- Verify DATABASE_URL is correct
- Check MySQL allows remote connections
- Test with: `mysql -h host -u user -p database`

### OAuth not working
- Verify DISCORD_CLIENT_SECRET is set
- Check callback URL matches Discord portal exactly
- Ensure HTTPS in production

### CORS errors
- Check DASHBOARD_URL matches frontend URL
- Verify credentials: true in CORS config

## 📄 License

MIT License - See `../LICENSE`

## 🔗 Related

- **Frontend Repository**: https://github.com/Netrohub/Solclient
- **Main Bot**: See `../README.md`
- **Deployment Guide**: See `DEPLOYMENT.md`

---

**Discord Server Manager Bot - Backend API** 🚀


