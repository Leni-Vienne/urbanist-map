import { Hono } from 'hono'
import { trpcServer } from '@hono/trpc-server'
import { router } from './trpc';
import { cors } from 'hono/cors'
import { Session, sessionMiddleware, CookieStore } from 'hono-sessions'
import { serveStatic } from 'hono/bun'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { imagesRouter } from './routes/images';
import { projectsRouter } from './routes/projects';

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
    origin: 'http://localhost:5173',
    credentials: true
}));

app.use('*', sessionMiddleware({
    store,
    sessionCookieName: 'session',
    encryptionKey: 'password_at_least_32_characters_long',
    expireAfterSeconds: 900,
}))

const appRouter = router({
    images: imagesRouter,
    projects: projectsRouter,
})

export type AppRouter = typeof appRouter;

// AI : File upload endpoint for images
app.post('/api/upload-image', async (c) => {
    try {
        const body = await c.req.parseBody()
        const file = body['image'] as File
        
        if (!file) {
            return c.json({ error: 'No file provided' }, 400)
        }
        
        if (!file.type.startsWith('image/')) {
            return c.json({ error: 'File must be an image' }, 400)
        }
        
        const uploadsDir = join(process.cwd(), 'uploads')
        await mkdir(uploadsDir, { recursive: true })
        
        // AI : Keep original extension, frontend handles WebP conversion
        const timestamp = Date.now()
        const extension = file.name.split('.').pop() || 'webp'
        const filename = `${timestamp}-${Math.random().toString(36).substring(2)}.${extension}`
        const filepath = join(uploadsDir, filename)
        
        const arrayBuffer = await file.arrayBuffer()
        await Bun.write(filepath, arrayBuffer)
        return c.json({ filename: filename })
        
    } catch (error) {
        console.error('File upload error:', error)
        return c.json({ error: 'Upload failed' }, 500)
    }
})

// AI : Serve uploaded files
app.use('/uploads/*', serveStatic({ root: './' }))

app.use('/trpc/*', trpcServer({
    router: appRouter,
    createContext(_opts, c) {
        console.log('in createContext')
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
  console.log('Path not found:', c.req.path, '- Serving index.html');
  // Make sure to return a Response object
  return c.html('<h1>Not Found</h1>'); // Temporary response, will replace with proper serving
});

export default {
  port: 3000,
  fetch: app.fetch
}