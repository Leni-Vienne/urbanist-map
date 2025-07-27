import { Hono } from 'hono'
import { Session } from 'hono-sessions'
import { serveStatic } from 'hono/bun'
import { config } from './config';
import { createLocalApp } from './shared/local-app';
import { LocalFileStorage } from './shared/storage';

type SessionData = {
    userId?: string;
    isAuthenticated?: boolean;
    username?: string;
}

// AI : Create the local app with full tRPC support
const { app: sharedApp, appRouter } = createLocalApp({
    corsOrigin: config.CORS_ORIGIN,
    sessionEncryptionKey: config.SESSION_ENCRYPTION_KEY,
    storage: new LocalFileStorage()
});

// AI : Create main app that includes static file serving for local development
const app = new Hono<{
    Variables: {
        session: Session<SessionData>,
    }
}>()

// AI : Mount the shared app routes
app.route('/', sharedApp)

// AI : Serve uploaded files from local uploads folder
app.get('/uploads/*', serveStatic({ root: './' }))

// AI : Static file serving for frontend
app.use('*', serveStatic({ root: './front/dist' }))

// AI : SPA fallback - serve index.html for client-side routing
app.notFound(async (c) => {
  try {
    const indexFile = Bun.file('./front/dist/index.html');
    const content = await indexFile.text();
    return c.html(content);
  } catch (_error) {
    return c.html('<h1>404 Not Found</h1>', 404);
  }
});

export type AppRouter = typeof appRouter;

export default {
  port: config.PORT,
  fetch: app.fetch
}
