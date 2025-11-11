# PowerShell deployment script for Windows

Write-Host "🚀 Deploying Discord Bot Dashboard to Railway + Cloudflare" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Railway CLI is installed
try {
    railway --version | Out-Null
} catch {
    Write-Host "❌ Railway CLI not installed" -ForegroundColor Red
    Write-Host "Install with: npm install -g @railway/cli" -ForegroundColor Yellow
    exit 1
}

# Check if Wrangler is installed
try {
    wrangler --version | Out-Null
} catch {
    Write-Host "❌ Wrangler not installed" -ForegroundColor Red
    Write-Host "Install with: npm install -g wrangler" -ForegroundColor Yellow
    exit 1
}

# Step 1: Build backend
Write-Host "📦 Step 1/5: Building backend..." -ForegroundColor Yellow
npm run build:server
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Backend built successfully" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy to Railway
Write-Host "🚂 Step 2/5: Deploying to Railway..." -ForegroundColor Yellow
railway up
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Railway deployment failed" -ForegroundColor Red
    Write-Host "Make sure you've run 'railway login' and 'railway link'" -ForegroundColor Yellow
    exit 1
}

# Get Railway URL
$RAILWAY_URL = railway domain
Write-Host "✅ Backend deployed to: $RAILWAY_URL" -ForegroundColor Green
Write-Host ""

# Step 3: Build frontend
Write-Host "📦 Step 3/5: Building frontend with Railway URL..." -ForegroundColor Yellow
Set-Location client
"VITE_API_URL=$RAILWAY_URL" | Out-File -FilePath .env.production -Encoding UTF8
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Frontend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Frontend built successfully" -ForegroundColor Green
Write-Host ""

# Step 4: Deploy to Cloudflare Pages
Write-Host "☁️ Step 4/5: Deploying to Cloudflare Pages..." -ForegroundColor Yellow
wrangler pages deploy dist --project-name discord-bot-dashboard
$PAGES_URL = "https://discord-bot-dashboard.pages.dev"
Write-Host "✅ Frontend deployed to: $PAGES_URL" -ForegroundColor Green
Write-Host ""

# Step 5: Update Railway environment
Set-Location ..
Write-Host "⚙️ Step 5/5: Updating Railway environment..." -ForegroundColor Yellow
railway variables set DASHBOARD_URL="$PAGES_URL"
railway restart

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "🎉 Deployment Complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📍 Your URLs:" -ForegroundColor Yellow
Write-Host "   Frontend: $PAGES_URL"
Write-Host "   Backend:  $RAILWAY_URL"
Write-Host ""
Write-Host "⚠️ Don't forget to:" -ForegroundColor Yellow
Write-Host "   1. Update Discord OAuth2 redirect URL to: $RAILWAY_URL/auth/discord/callback"
Write-Host "   2. Set environment variables in Railway dashboard"
Write-Host "   3. Test the dashboard at: $PAGES_URL"
Write-Host ""
Write-Host "🎊 Your dashboard is now live worldwide! 🌍" -ForegroundColor Magenta

