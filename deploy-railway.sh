#!/bin/bash

echo "🚀 Deploying Discord Bot Dashboard to Railway + Cloudflare"
echo "============================================================"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not installed"
    echo "Install with: npm install -g @railway/cli"
    exit 1
fi

# Check if Wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler not installed"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

# Step 1: Build backend
echo "📦 Step 1/5: Building backend..."
npm run build:server
if [ $? -ne 0 ]; then
    echo "❌ Backend build failed"
    exit 1
fi
echo "✅ Backend built successfully"
echo ""

# Step 2: Deploy to Railway
echo "🚂 Step 2/5: Deploying to Railway..."
railway up
if [ $? -ne 0 ]; then
    echo "❌ Railway deployment failed"
    echo "Make sure you've run 'railway login' and 'railway link'"
    exit 1
fi

# Get Railway URL
RAILWAY_URL=$(railway domain | grep -oP 'https://[^\s]+')
echo "✅ Backend deployed to: $RAILWAY_URL"
echo ""

# Step 3: Build frontend
echo "📦 Step 3/5: Building frontend with Railway URL..."
cd client
echo "VITE_API_URL=$RAILWAY_URL" > .env.production
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed"
    exit 1
fi
echo "✅ Frontend built successfully"
echo ""

# Step 4: Deploy to Cloudflare Pages
echo "☁️ Step 4/5: Deploying to Cloudflare Pages..."
wrangler pages deploy dist --project-name discord-bot-dashboard
PAGES_URL="https://discord-bot-dashboard.pages.dev"
echo "✅ Frontend deployed to: $PAGES_URL"
echo ""

# Step 5: Update Railway environment
cd ..
echo "⚙️ Step 5/5: Updating Railway environment..."
railway variables set DASHBOARD_URL="$PAGES_URL"
railway restart

echo ""
echo "============================================================"
echo "🎉 Deployment Complete!"
echo "============================================================"
echo ""
echo "📍 Your URLs:"
echo "   Frontend: $PAGES_URL"
echo "   Backend:  $RAILWAY_URL"
echo ""
echo "⚠️ Don't forget to:"
echo "   1. Update Discord OAuth2 redirect URL to: $RAILWAY_URL/auth/discord/callback"
echo "   2. Set environment variables in Railway dashboard"
echo "   3. Test the dashboard at: $PAGES_URL"
echo ""
echo "🎊 Your dashboard is now live worldwide! 🌍"

