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

// AI : Initialize the application asynchronously
async function initializeApp() {
  // AI : Create the local app with full tRPC support
  const appResult = await createLocalApp({
      corsOrigin: config.CORS_ORIGIN,
      sessionEncryptionKey: config.SESSION_ENCRYPTION_KEY,
      storage: new LocalFileStorage()
  });

  const { app: sharedApp, appRouter } = appResult;

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
    } catch (error) {
      console.error('Error loading index.html:', error);
      return c.html('<h1>404 Not Found</h1>', 404);
    }
  });

  return { app, appRouter };
}

// AI : Initialize and start the server
const { app, appRouter } = await initializeApp();

export type AppRouter = typeof appRouter;

export default {
  port: config.PORT,
  fetch: app.fetch
}
