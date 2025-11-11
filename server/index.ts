import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Server } from 'socket.io';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.DASHBOARD_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: process.env.DASHBOARD_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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

// Discord OAuth2
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3001/auth/discord/callback',
      scope: ['identify', 'guilds'],
    },
    (accessToken: string, refreshToken: string, profile: any, done: any) => {
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

// Auth routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get(
  '/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect(process.env.DASHBOARD_URL || 'http://localhost:5173/dashboard');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

app.get('/auth/user', (req, res) => {
  res.json(req.user || null);
});

// Middleware to check authentication
const requireAuth = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
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

app.get('/api/guild/:guildId/stats', requireAuth, async (req, res) => {
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
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/guild/:guildId/leaderboard', requireAuth, async (req, res) => {
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

app.get('/api/guild/:guildId/activity', requireAuth, async (req, res) => {
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

app.get('/api/guild/:guildId/user/:userId', requireAuth, async (req, res) => {
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

// Start server
const PORT = parseInt(process.env.DASHBOARD_API_PORT || '3001', 10);
server.listen(PORT, () => {
  console.log(`Dashboard API server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});

export default app;

