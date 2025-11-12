import express, { type RequestHandler } from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Server } from 'socket.io';
import http from 'http';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DATABASE_URL', 'SESSION_SECRET'];
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach((key) => console.error(`   - ${key}`));
  console.error('\n💡 Add these to Railway or your .env file');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// CORS configuration - allow both production and development
const additionalOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const allowedOrigins = Array.from(
  new Set(
    [
      process.env.DASHBOARD_URL,
      'http://localhost:5173',
      'http://localhost:3000',
      ...additionalOrigins,
    ].filter((origin): origin is string => Boolean(origin))
  )
);

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
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('⚠️  CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 204,
}));
app.use(express.json());
app.use(cookieParser());

const sessionSecret = process.env.SESSION_SECRET as string;
const redisUrl = process.env.REDIS_URL || process.env.SESSION_REDIS_URL;
let sessionStore: session.Store | undefined;
let redisClientInstance: ReturnType<typeof createClient> | null = null;

if (redisUrl) {
  const redisClient = createClient({ url: redisUrl });
  redisClientInstance = redisClient;

  redisClient.on('error', (error) => {
    console.error('❌ Redis session store error:', error);
  });

  redisClient
    .connect()
    .then(() => {
      console.log('✅ Redis session store connected');
    })
    .catch((error) => {
      console.error('❌ Failed to connect to Redis session store:', error);
    });

  sessionStore = new RedisStore({
    client: redisClient,
    prefix: process.env.SESSION_REDIS_PREFIX || 'dashboard:sess:',
    disableTouch: false,
  });
} else if (isProduction) {
  console.error('❌ REDIS_URL is required in production for session storage');
  process.exit(1);
} else {
  console.warn('⚠️ REDIS_URL not provided; using in-memory session store (development only)');
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} from ${req.get('origin') || 'unknown'}`);
  next();
});

app.use(
  session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  },
}) as unknown as RequestHandler;

const csrfExemptPaths = new Set(['/health', '/health/detailed', '/metrics']);

app.use((req, res, next) => {
  if (csrfExemptPaths.has(req.path)) {
    return next();
  }
  return csrfProtection(req, res, next);
});

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

app.get('/auth/csrf', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
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

const startOfUtcDay = (date: Date): Date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const addUtcDays = (date: Date, amount: number): Date => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + amount);
  return d;
};

const minutesBetween = (start: Date, end: Date): number => {
  return Math.max((end.getTime() - start.getTime()) / 60000, 0);
};

const determinePriority = (reason?: string | null): 'low' | 'medium' | 'high' | 'urgent' => {
  if (!reason) return 'medium';
  const lower = reason.toLowerCase();
  if (lower.includes('urgent') || lower.includes('raid') || lower.includes('critical')) {
    return 'urgent';
  }
  if (lower.includes('high') || lower.includes('warning')) {
    return 'high';
  }
  if (lower.includes('medium') || lower.includes('review')) {
    return 'medium';
  }
  return 'low';
};

const extractTags = (reason?: string | null): string[] => {
  if (!reason) return [];
  return reason
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9#_-]/gi, ''))
    .filter((word) => word.length >= 3)
    .slice(0, 4);
};

const formatUsername = (username?: string | null, discriminator?: string | null): string => {
  if (!username) return 'Unknown Member';
  if (discriminator && discriminator !== '0') {
    return `${username}#${discriminator}`;
  }
  return username;
};

const auditStatus = (action: string): 'success' | 'pending' | 'error' => {
  const normalized = action.toUpperCase();
  if (normalized.includes('FAIL') || normalized.includes('ERROR')) {
    return 'error';
  }
  if (normalized.includes('PENDING') || normalized.includes('REQUEST')) {
    return 'pending';
  }
  return 'success';
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

app.get('/api/guild/:guildId/dashboard/metrics', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    const [activeWarnings, completedWarnings, unreadAlerts] = await Promise.all([
      prisma.warning.findMany({
        where: { guildId, active: true },
        select: { createdAt: true },
      }),
      prisma.warning.findMany({
        where: { guildId, active: false },
        select: { createdAt: true, expiresAt: true },
      }),
      prisma.notification.count({
        where: { guildId, read: false },
      }),
    ]);

    let avgResponseMinutes = 0;
    if (completedWarnings.length > 0) {
      const totalMinutes = completedWarnings.reduce((total, warning) => {
        const completion = warning.expiresAt ?? new Date();
        return total + minutesBetween(warning.createdAt, completion);
      }, 0);
      avgResponseMinutes = totalMinutes / completedWarnings.length;
    } else if (activeWarnings.length > 0) {
      const now = new Date();
      const totalMinutes = activeWarnings.reduce((total, warning) => {
        return total + minutesBetween(warning.createdAt, now);
      }, 0);
      avgResponseMinutes = totalMinutes / activeWarnings.length;
    }

    const totalWarnings = activeWarnings.length + completedWarnings.length;
    const completionRate =
      totalWarnings === 0 ? 100 : (completedWarnings.length / totalWarnings) * 100;

    const startToday = startOfUtcDay(new Date());
    const totalCompletedToday = completedWarnings.filter((warning) => {
      const completion = warning.expiresAt ?? warning.createdAt;
      return completion >= startToday;
    }).length;

    res.json({
      activeReinforcements: activeWarnings.length,
      avgResponseMinutes,
      activeAlerts: unreadAlerts,
      completionRate,
      totalCompletedToday,
    });
  } catch (error) {
    console.error('Error loading dashboard metrics:', error);
    res.status(500).json({ error: 'Failed to load dashboard metrics' });
  }
});

app.get('/api/guild/:guildId/reinforcements', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    const warnings = await prisma.warning.findMany({
      where: { guildId, active: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (warnings.length === 0) {
      return res.json([]);
    }

    const relatedUserIds = Array.from(
      new Set(
        warnings.flatMap((warning) =>
          [warning.userId, warning.moderatorId].filter((id): id is string => Boolean(id))
        )
      )
    );

    const relatedUsers = relatedUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: relatedUserIds } },
          select: { id: true, username: true, discriminator: true },
        })
      : [];

    const userMap = new Map(relatedUsers.map((user) => [user.id, user]));

    const response = warnings.map((warning) => {
      const requester = userMap.get(warning.userId);
      const moderator = warning.moderatorId ? userMap.get(warning.moderatorId) : null;

      return {
        id: warning.id,
        user: formatUsername(requester?.username, requester?.discriminator) ?? warning.userId,
        request: warning.reason || 'No reason provided',
        priority: determinePriority(warning.reason),
        status: warning.moderatorId ? ('in_progress' as const) : ('queued' as const),
        assignee: moderator ? formatUsername(moderator.username, moderator.discriminator) : undefined,
        tags: extractTags(warning.reason),
        timestamp: warning.createdAt.toISOString(),
        hasAttachment: false,
      };
    });

    res.json(response);
  } catch (error) {
    console.error('Error loading reinforcements:', error);
    res.status(500).json({ error: 'Failed to load reinforcements' });
  }
});

app.get('/api/guild/:guildId/alerts', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    const alerts = await prisma.notification.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    const response = alerts.map((alert) => {
      const type = (alert.type || 'info').toLowerCase();
      let mappedType: 'info' | 'warning' | 'urgent' | 'resolved' = 'info';
      if (type.includes('urgent') || type.includes('warning') || type.includes('ban')) {
        mappedType = 'urgent';
      } else if (type.includes('error') || type.includes('strike')) {
        mappedType = 'warning';
      } else if (type.includes('resolved')) {
        mappedType = 'resolved';
      }

      const metadata =
        alert.metadata && typeof alert.metadata === 'object' ? (alert.metadata as Record<string, unknown>) : {};

      return {
        id: alert.id,
        type: mappedType,
        title: alert.title || alert.type || 'Alert',
        description: alert.message || 'No additional information provided.',
        channel:
          typeof metadata.channel === 'string'
            ? metadata.channel
            : typeof metadata.channelName === 'string'
            ? metadata.channelName
            : undefined,
        user: typeof metadata.user === 'string' ? metadata.user : undefined,
        timestamp: alert.createdAt.toISOString(),
      };
    });

    res.json(response);
  } catch (error) {
    console.error('Error loading alerts:', error);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

app.get('/api/guild/:guildId/activity-feed', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    const audits = await prisma.audit.findMany({
      where: { guildId },
      include: {
        actor: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });

    const response = audits.map((audit) => ({
      id: audit.id,
      user: audit.actor ? formatUsername(audit.actor.username, audit.actor.discriminator) : 'System',
      action: audit.action || 'Performed an action',
      timestamp: (audit.timestamp ?? new Date()).toISOString(),
      status: auditStatus(audit.action || ''),
    }));

    res.json(response);
  } catch (error) {
    console.error('Error loading activity feed:', error);
    res.status(500).json({ error: 'Failed to load activity feed' });
  }
});

app.get('/api/guild/:guildId/moderators', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    const members = await prisma.member.findMany({
      where: { guildId, isActive: true },
      include: { user: true },
      take: 50,
    });

    if (members.length === 0) {
      return res.json([]);
    }

    const moderatorIds = members.map((member) => member.userId);

    const [activeAssignments, completedWarnings, completedToday, presenceSnapshots] = await Promise.all([
      prisma.warning.groupBy({
        by: ['moderatorId'],
        where: {
          guildId,
          active: true,
        },
        _count: { _all: true },
      }),
      prisma.warning.findMany({
        where: {
          guildId,
          active: false,
          moderatorId: { in: moderatorIds },
        },
        select: { moderatorId: true, createdAt: true, expiresAt: true },
      }),
      prisma.warning.groupBy({
        by: ['moderatorId'],
        where: {
          guildId,
          active: false,
          moderatorId: { in: moderatorIds },
          expiresAt: { gte: startOfUtcDay(new Date()) },
        },
        _count: { _all: true },
      }),
      prisma.presenceSnapshot.findMany({
        where: {
          guildId,
          userId: { in: moderatorIds },
        },
        orderBy: { timestamp: 'desc' },
        distinct: ['userId'],
      }),
    ]);

    const activeMap = new Map(
      activeAssignments
        .filter((entry) => entry.moderatorId)
        .map((entry) => {
          const count =
            typeof entry._count === 'object' && entry._count !== null && '_all' in entry._count
              ? (entry._count as { _all?: number })._all ?? 0
              : 0;
          return [entry.moderatorId as string, count];
        })
    );

    const completedTodayMap = new Map(
      completedToday
        .filter((entry) => entry.moderatorId)
        .map((entry) => {
          const count =
            typeof entry._count === 'object' && entry._count !== null && '_all' in entry._count
              ? (entry._count as { _all?: number })._all ?? 0
              : 0;
          return [entry.moderatorId as string, count];
        })
    );

    const presenceMap = new Map(presenceSnapshots.map((snapshot) => [snapshot.userId, snapshot.status]));

    const durationsByModerator = new Map<string, number[]>();
    completedWarnings.forEach((warning) => {
      if (!warning.moderatorId) return;
      const minutes = minutesBetween(warning.createdAt, warning.expiresAt ?? new Date());
      const list = durationsByModerator.get(warning.moderatorId) || [];
      list.push(minutes);
      durationsByModerator.set(warning.moderatorId, list);
    });

    const result = members.map((member) => {
      const assignments = activeMap.get(member.userId) ?? 0;
      const completedCount = completedTodayMap.get(member.userId) ?? 0;
      const durations = durationsByModerator.get(member.userId) ?? [];
      const avgResponseMinutes =
        durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;

      const calculatedScore = Math.max(
        55,
        Math.min(100, 100 - avgResponseMinutes * 2 + assignments * -1 + completedCount * 3)
      );

      const presence = (presenceMap.get(member.userId) || 'offline').toLowerCase();
      let status: 'online' | 'away' | 'offline' = 'offline';
      if (presence === 'online') status = 'online';
      else if (presence === 'idle' || presence === 'dnd') status = 'away';

      const rawRoles = member.roles as unknown;
      let rolesValue = 'Moderator';
      if (Array.isArray(rawRoles) && rawRoles.length > 0) {
        rolesValue = String(rawRoles[0]);
      } else if (typeof rawRoles === 'string' && rawRoles.trim().length > 0) {
        rolesValue = rawRoles;
      }

      return {
        name: member.user ? formatUsername(member.user.username, member.user.discriminator) : member.userId,
        role: rolesValue,
        activeAssignments: assignments,
        completedToday: completedCount,
        avgResponseMinutes,
        status,
        responseScore: Math.round(calculatedScore),
      };
    });

    res.json(
      result.sort((a, b) => b.responseScore - a.responseScore || b.completedToday - a.completedToday)
    );
  } catch (error) {
    console.error('Error loading moderators:', error);
    res.status(500).json({ error: 'Failed to load moderator data' });
  }
});

app.get('/api/guild/:guildId/leaderboard', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;
    const metric = (req.query.metric as string) ?? 'points';
    const limit = parseInt((req.query.limit as string) ?? '10', 10);

    if (metric === 'messages') {
      const messageLeaders = await prisma.messageStat.groupBy({
        by: ['userId'],
        where: { guildId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit,
      });

      const userIds = messageLeaders.map((entry) => entry.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, discriminator: true },
      });
      const userMap = new Map(users.map((user) => [user.id, user]));

      const response = messageLeaders.map((entry, index) => {
        const user = userMap.get(entry.userId);
        return {
          position: index + 1,
          userId: entry.userId,
          username: user ? formatUsername(user.username, user.discriminator) : entry.userId,
          discriminator: user?.discriminator ?? null,
          points: entry._count.id,
          level: undefined,
        };
      });

      return res.json(response);
    }

    const orderBy =
      metric === 'level'
        ? { level: 'desc' as const, points: 'desc' as const }
        : { points: 'desc' as const, level: 'desc' as const };

    const pointLeaders = await prisma.points.findMany({
      where: { guildId },
      include: { user: true },
      orderBy,
      take: limit,
    });

    const response = pointLeaders.map((entry, index) => ({
      position: index + 1,
      userId: entry.userId,
      username: entry.user ? formatUsername(entry.user.username, entry.user.discriminator) : entry.userId,
      discriminator: entry.user?.discriminator ?? null,
      points: entry.points,
      level: entry.level,
    }));

    res.json(response);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
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
        attachments: true,
      },
      orderBy: { date: 'asc' },
    });

    const response = activity.map((entry) => ({
      date: entry.date.toISOString().split('T')[0],
      messages: entry._sum.messages ?? 0,
      images: entry._sum.images ?? 0,
      attachments: entry._sum.attachments ?? 0,
    }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

app.get('/api/guild/:guildId/analytics', requireAuth, validateSnowflake('guildId'), async (req, res) => {
  try {
    const { guildId } = req.params;

    const endDate = startOfUtcDay(new Date());
    const startDate = addUtcDays(endDate, -13);

    const [warnings, notifications, assignmentLoadRaw] = await Promise.all([
      prisma.warning.findMany({
        where: {
          guildId,
          createdAt: { gte: startDate },
        },
        select: { id: true, createdAt: true, expiresAt: true, active: true, reason: true, moderatorId: true },
      }),
      prisma.notification.findMany({
        where: {
          guildId,
          createdAt: { gte: startDate },
        },
        select: { createdAt: true, type: true },
      }),
      prisma.warning.groupBy({
        by: ['moderatorId'],
        where: {
          guildId,
          active: true,
        },
        _count: { _all: true },
      }),
    ]);

    const priorityBuckets = { low: 0, medium: 0, high: 0, urgent: 0 };
    warnings.forEach((warning) => {
      const priority = determinePriority(warning.reason);
      priorityBuckets[priority] += 1;
    });

    const dayBuckets = Array.from({ length: 14 }).map((_, index) => {
      const dayStart = addUtcDays(startDate, index);
      const dayEnd = addUtcDays(dayStart, 1);
      return { dayStart, dayEnd };
    });

    const reinforcementFlow = dayBuckets.map(({ dayStart, dayEnd }) => {
      const created = warnings.filter(
        (warning) => warning.createdAt >= dayStart && warning.createdAt < dayEnd
      ).length;

      const resolved = warnings.filter((warning) => {
        if (warning.active) return false;
        const completed = warning.expiresAt ?? warning.createdAt;
        return completed >= dayStart && completed < dayEnd;
      }).length;

      return {
        date: dayStart.toISOString().split('T')[0],
        created,
        resolved,
      };
    });

    const cumulativeCreated: number[] = [];
    const cumulativeResolved: number[] = [];
    reinforcementFlow.forEach((entry, index) => {
      cumulativeCreated[index] = (cumulativeCreated[index - 1] ?? 0) + entry.created;
      cumulativeResolved[index] = (cumulativeResolved[index - 1] ?? 0) + entry.resolved;
    });

    const responseTrend = dayBuckets.map(({ dayStart, dayEnd }, index) => {
      const dayWarnings = warnings.filter((warning) => {
        if (warning.active) return false;
        const completion = warning.expiresAt ?? warning.createdAt;
        return completion >= dayStart && completion < dayEnd;
      });

      const avgMinutes =
        dayWarnings.length > 0
          ? dayWarnings.reduce((total, warning) => {
              const completion = warning.expiresAt ?? warning.createdAt;
              return total + minutesBetween(warning.createdAt, completion);
            }, 0) / dayWarnings.length
          : 0;

      return {
        date: dayStart.toISOString().split('T')[0],
        avgResponseMinutes: avgMinutes,
        inProgress: cumulativeCreated[index] - cumulativeResolved[index],
      };
    });

    const sentimentTrend = dayBuckets.map(({ dayStart, dayEnd }) => {
      const dayNotifications = notifications.filter(
        (notification) => notification.createdAt >= dayStart && notification.createdAt < dayEnd
      );

      let positive = 0;
      let neutral = 0;
      let negative = 0;

      dayNotifications.forEach((notification) => {
        const type = (notification.type || '').toLowerCase();
        if (type.includes('level') || type.includes('achievement')) {
          positive += 1;
        } else if (type.includes('warn') || type.includes('ban') || type.includes('incident')) {
          negative += 1;
        } else {
          neutral += 1;
        }
      });

      return {
        date: dayStart.toISOString().split('T')[0],
        positive,
        neutral,
        negative,
      };
    });

    const moderatorIds = assignmentLoadRaw
      .map((entry) => entry.moderatorId)
      .filter((id): id is string => Boolean(id));

    const moderatorUsers = moderatorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: moderatorIds } },
          select: { id: true, username: true, discriminator: true },
        })
      : [];

    const moderatorMap = new Map(moderatorUsers.map((user) => [user.id, user]));

    const modAssignmentLoad = assignmentLoadRaw
      .filter((entry) => entry.moderatorId)
      .map((entry) => {
        const user = entry.moderatorId ? moderatorMap.get(entry.moderatorId) : null;
        const count =
          typeof entry._count === 'object' && entry._count !== null && '_all' in entry._count
            ? (entry._count as { _all?: number })._all ?? 0
            : 0;
        return {
          name: user ? formatUsername(user.username, user.discriminator) : 'Unassigned',
          assignments: count,
        };
      })
      .sort((a, b) => b.assignments - a.assignments)
      .slice(0, 8);

    res.json({
      reinforcementFlow,
      priorityDistribution: priorityBuckets,
      responseTrend,
      modAssignmentLoad,
      sentimentTrend,
    });
  } catch (error) {
    console.error('Error loading analytics:', error);
    res.status(500).json({ error: 'Failed to load analytics data' });
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

const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
signals.forEach((signal) => {
  process.on(signal, () => {
    redisClientInstance
      ?.quit()
      .then(() => {
        console.log('✅ Redis session store disconnected');
      })
      .catch((error) => {
        console.error('⚠️ Error closing Redis connection:', error);
      });
  });
});

app.use((err: any, req: any, res: any, next: any) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.warn('⚠️ Invalid CSRF token', err);
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  console.error('❌ Express Error:', err);
  return res.status(500).json({ error: 'Internal server error', message: err.message });
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

