import { Hono } from 'hono'
import { trpcServer } from '@hono/trpc-server'
import { router } from './trpc';
import { cors } from 'hono/cors'
import { Session, sessionMiddleware, CookieStore } from 'hono-sessions'
import { serveStatic } from 'hono/bun'
import { config } from './config';

import { projectRouter } from './routes/project';
import { overlayRouter } from './routes/overlay';
import { citiesRouter } from './routes/cities';
import { countriesRouter } from './routes/countries';
import { moderationRouter } from './routes/moderation';

type sessionData = {
    userId?: string;
    isAuthenticated?: boolean;
    username?: string;
}

const app = new Hono<{
    Variables: {
        session: Session<sessionData>,
    }
}>()

const store = new CookieStore()

app.use('*', cors({
    origin: config.CORS_ORIGIN,
    credentials: true
}));

// AI : Global request size limit middleware (1MB for JSON, 10MB for file uploads)
app.use('*', async (c, next) => {
    const contentLength = c.req.header('content-length');
    if (contentLength) {
        const size = parseInt(contentLength);
        const isFileUpload = c.req.path.includes('/upload');
        const maxSize = isFileUpload ? 10 * 1024 * 1024 : 1024 * 1024; // 10MB for uploads, 1MB for other requests
        
        if (size > maxSize) {
            return c.json({ 
                error: `Request too large. Maximum size is ${isFileUpload ? '10MB' : '1MB'}` 
            }, 413);
        }
    }
    await next();
});

app.use('*', sessionMiddleware({
    store,
    sessionCookieName: 'session',
    encryptionKey: config.SESSION_ENCRYPTION_KEY,
    expireAfterSeconds: 900,
}) as any)

const appRouter = router({
    overlay: overlayRouter,
    project: projectRouter,
    cities: citiesRouter,
    country: countriesRouter,
    moderation: moderationRouter,
})

export type AppRouter = typeof appRouter;

// AI : File upload endpoint for images
app.post('/api/upload-image', async (c) => {
    try {
        const body = await c.req.formData();
        const file = body.get('image') as File;

        if (!file) {
            return c.json({ error: 'No file provided' }, 400);
        }

        // AI : Check file size limit (10MB)
        const maxFileSize = 10 * 1024 * 1024; // 10MB in bytes
        if (file.size > maxFileSize) {
            return c.json({ error: 'File too large. Maximum size is 10MB' }, 400);
        }

        // AI : Check file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed' }, 400);
        }

        // AI : Check filename length
        if (file.name.length > 255) {
            return c.json({ error: 'Filename too long. Maximum length is 255 characters' }, 400);
        }
        
        // AI : Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = file.name.split('.').pop() ?? 'webp';
        const filename = `${timestamp}-${randomString}.${fileExtension}`;
        
        // AI : Save file to uploads directory
        const buffer = await file.arrayBuffer();
        await Bun.write(`./uploads/${filename}`, buffer);
        
        return c.json({ 
            success: true, 
            filename: filename,
            url: `/uploads/${filename}`
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        return c.json({ error: 'Failed to upload file' }, 500);
    }
});

// AI : Serve uploaded files
app.use('/uploads/*', serveStatic({ root: './' }))

app.use('/trpc/*', trpcServer({
    router: appRouter,
    createContext(_opts, c) {
        return {
            session: c.get('session')
        };
    }
}));


app.get('/api/check-session', (c) => {
    const session = c.get('session')
    console.log('Session data:', {
        userId: session.get('userId'),
        isAuthenticated: session.get('isAuthenticated'),
        username: session.get('username')
    });
    return c.json({
        userId: session.get('userId'),
        isAuthenticated: session.get('isAuthenticated'),
        username: session.get('username')
    });
});

// Static file serving - first try to serve exact files
app.use('*', serveStatic({ root: './front/dist' }))

// If no file is found, serve index.html for SPA routing
app.notFound((c) => {
  // Make sure to return a Response object
  return c.html('<h1>Not Found</h1>'); // Temporary response, will replace with proper serving
});

export default {
  port: config.PORT,
  fetch: app.fetch
}
