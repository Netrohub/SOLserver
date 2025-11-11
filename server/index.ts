import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Server } from 'socket.io';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

// Validate required environment variables
const requiredEnvVars = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach((key) => console.error(`   - ${key}`));
  console.error('\n💡 Add these to Railway or your .env file');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// CORS configuration - allow both production and development
const allowedOrigins: string[] = [
  process.env.DASHBOARD_URL || '',
  'http://localhost:5173',
  'http://localhost:3000',
  'https://solclient.pages.dev',
].filter((origin): origin is string => Boolean(origin) && origin !== ''); // Remove empty strings

console.log('✅ Allowed CORS origins:', allowedOrigins);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('⚠️  CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} from ${req.get('origin') || 'unknown'}`);
  next();
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Import Prisma from parent project
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

// Test database connection on startup
prisma.$connect()
  .then(() => {
    console.log('✅ Database connection successful');
  })
  .catch((error) => {
    console.error('❌ Database connection failed:', error);
    console.error('DATABASE_URL format should be: mysql://username:password@host:port/database');
    process.exit(1);
  });

// Discord OAuth2
try {
  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID!,
        clientSecret: process.env.DISCORD_CLIENT_SECRET!,
        callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3001/auth/discord/callback',
        scope: ['identify', 'guilds'],
      },
      (accessToken: string, refreshToken: string, profile: any, done: any) => {
        console.log('✅ Discord OAuth callback - User authenticated:', profile.username);
        return done(null, profile);
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((obj: any, done) => {
    done(null, obj);
  });
  
  console.log('✅ Discord OAuth strategy initialized');
} catch (error) {
  console.error('❌ Failed to initialize Discord OAuth:', error);
  process.exit(1);
}

// Auth routes
app.get('/auth/discord', (req, res, next) => {
  console.log('🔐 Starting Discord OAuth flow');
  passport.authenticate('discord')(req, res, next);
});

app.get(
  '/auth/discord/callback',
  (req, res, next) => {
    console.log('🔄 Discord callback received');
    passport.authenticate('discord', { 
      failureRedirect: '/',
      failureMessage: true 
    })(req, res, next);
  },
  (req, res) => {
    console.log('✅ OAuth successful, redirecting to dashboard');
    res.redirect(process.env.DASHBOARD_URL || 'http://localhost:5173/dashboard');
  }
);

app.get('/auth/logout', (req, res) => {
  console.log('👋 User logging out');
  req.logout(() => {
    res.redirect(process.env.DASHBOARD_URL || 'http://localhost:5173');
  });
});

app.get('/auth/user', (req, res) => {
  console.log('👤 User info requested');
  res.json(req.user || null);
});

// Health check endpoint - must respond quickly for Railway
app.get('/health', (req, res) => {
  // Simple fast response for Railway health check
  res.status(200).send('OK');
});

// Detailed health endpoint
app.get('/health/detailed', async (req, res) => {
  try {
    // Test database
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// Middleware to check authentication
const requireAuth = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Middleware to validate Snowflake IDs (Discord IDs)
const validateSnowflake = (paramName: string) => (req: any, res: any, next: any) => {
  const id = req.params[paramName];
  if (!id || !/^\d{17,19}$/.test(id)) {
    return res.status(400).json({ error: `Invalid ${paramName}` });
  }
  next();
};

// API Routes
app.get('/api/guilds', requireAuth, async (req: any, res) => {
  try {
    const userGuilds = req.user.guilds || [];
    res.json(userGuilds);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch guilds' });
  }
});

app.get('/api/guild/:guildId/stats', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    // Basic stats
    const totalMembers = await prisma.member.count({
      where: { guildId, isActive: true },
    });

    const totalMessages = await prisma.messageStat.count({
      where: { guildId },
    });

    const totalPoints = await prisma.points.aggregate({
      where: { guildId },
      _sum: { points: true },
    });

    res.json({
      totalMembers,
      totalMessages,
      totalPoints: totalPoints._sum.points || 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/guild/:guildId/leaderboard', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { metric = 'points', limit = 10 } = req.query;

    let leaderboard;

    if (metric === 'points' || metric === 'level') {
      const orderBy = metric === 'points' ? { points: 'desc' as const } : { level: 'desc' as const };
      leaderboard = await prisma.points.findMany({
        where: { guildId },
        include: { user: true },
        orderBy,
        take: parseInt(limit as string),
      });
    } else {
      const data = await prisma.messageStat.groupBy({
        by: ['userId'],
        where: { guildId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: parseInt(limit as string),
      });

      leaderboard = await Promise.all(
        data.map(async (d: any) => {
          const user = await prisma.user.findUnique({ where: { id: d.userId } });
          return { userId: d.userId, user, value: d._count.id };
        })
      );
    }

    res.json(leaderboard);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/guild/:guildId/activity', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const { days = 7 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days as string));

    const activity = await prisma.dailyAggregate.groupBy({
      by: ['date'],
      where: {
        guildId,
        date: { gte: startDate },
      },
      _sum: {
        messages: true,
        images: true,
      },
      orderBy: { date: 'asc' },
    });

    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

app.get('/api/guild/:guildId/user/:userId', requireAuth, validateSnowflake('guildId'), validateSnowflake('userId'), async (req, res) => {
  try {
    const { guildId, userId } = req.params;

    const member = await prisma.member.findUnique({
      where: { guildId_userId: { guildId, userId } },
      include: { user: true },
    });

    const points = await prisma.points.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    const messageCount = await prisma.messageStat.count({
      where: { guildId, userId },
    });

    const achievements = await prisma.userAchievement.count({
      where: { guildId, userId, completed: true },
    });

    res.json({
      member,
      points,
      messageCount,
      achievements,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe:guild', (guildId) => {
    socket.join(`guild:${guildId}`);
    console.log(`Client ${socket.id} subscribed to guild ${guildId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Export io for use in other parts of the app
export { io };

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

// Express error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('❌ Express Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_API_PORT || '3001', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 ================================================');
  console.log('✅ Dashboard API server running');
  console.log(`✅ Port: ${PORT}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ Dashboard URL: ${process.env.DASHBOARD_URL || 'http://localhost:5173'}`);
  console.log(`✅ Callback URL: ${process.env.DISCORD_CALLBACK_URL || 'Not set'}`);
  console.log(`✅ Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  console.log(`✅ WebSocket server ready`);
  console.log('🚀 ================================================\n');
});

export default app;

