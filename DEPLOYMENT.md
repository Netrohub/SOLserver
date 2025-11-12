# 🚀 Quick Deployment Guide

## 🎯 Easiest Method: Railway + Cloudflare Pages

### Prerequisites

```bash
npm install -g @railway/cli wrangler
```

### Step 1: Deploy Backend to Railway

```bash
cd dashboard

# Login
railway login

# Create project
railway init

# Add environment variables (do this in Railway dashboard):
# - DATABASE_URL
# - DISCORD_CLIENT_ID
# - DISCORD_CLIENT_SECRET
# - SESSION_SECRET (use a long, random value)
# - REDIS_URL (for session storage, e.g. redis://default:password@host:port)
# - DASHBOARD_URL (will update after frontend deployment)
# - DISCORD_CALLBACK_URL (will update after backend deployment)

# Deploy
railway up

# Get your URL
railway domain
# Example output: discord-bot-api.up.railway.app
```

### Step 2: Update Environment Variables

```bash
# Set callback URL (use your Railway domain)
railway variables set DISCORD_CALLBACK_URL="https://discord-bot-api.up.railway.app/auth/discord/callback"

# Dashboard URL (temporary, will update after frontend deployment)
railway variables set DASHBOARD_URL="http://localhost:5173"
```

### Step 3: Update Discord Developer Portal

1. Go to https://discord.com/developers/applications
2. Select your app
3. OAuth2 → Redirects
4. Add: `https://discord-bot-api.up.railway.app/auth/discord/callback`
5. Save

### Step 4: Deploy Frontend to Cloudflare Pages

```bash
cd client

# Create production environment file
# Replace with YOUR Railway URL
echo "VITE_API_URL=https://discord-bot-api.up.railway.app" > .env.production

# Build
npm run build

# Login to Cloudflare
wrangler login

# Deploy
wrangler pages deploy dist --project-name discord-bot-dashboard

# Note the URL (example: discord-bot-dashboard.pages.dev)
```

### Step 5: Update Backend with Frontend URL

```bash
cd ..

# Update dashboard URL with your Cloudflare Pages URL
railway variables set DASHBOARD_URL="https://discord-bot-dashboard.pages.dev"

# Restart to apply
railway restart
```

### Step 6: Test!

Visit: `https://discord-bot-dashboard.pages.dev`

---

## ✅ Done!

Your dashboard is now live globally! 🌍

- **Frontend**: Cloudflare Pages (Global CDN)
- **Backend**: Railway (Auto-scaling)
- **Database**: Hostinger MySQL
- **Bot**: Your machine

---

## 📊 Monitoring

### Check Backend Status

```bash
railway logs
```

### Check Frontend Deployment

```bash
wrangler pages deployment list --project-name discord-bot-dashboard
```

---

## 🔄 Updates

### Update Backend

```bash
cd dashboard
railway up
```

### Update Frontend

```bash
cd dashboard/client
npm run build
wrangler pages deploy dist --project-name discord-bot-dashboard
```

---

## 💰 Cost

- Cloudflare Pages: **FREE**
- Railway: **FREE** (500 hours/month = ~20 days uptime)
- Railway Paid: **$5/month** for always-on

**Total**: $0-5/month for global deployment! 🎉


