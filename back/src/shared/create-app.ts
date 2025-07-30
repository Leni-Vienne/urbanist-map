import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Session, sessionMiddleware, CookieStore } from 'hono-sessions'
import { AppConfig, SessionData, FileUploadResult, FileUploadError } from './types';
import { createAppRouter } from './routers';
import { trpcServer } from '@hono/trpc-server';

// AI : Unified app creation function for both local and worker environments
export async function createSharedApp(config: AppConfig & { database: any }) {
    const app = new Hono<{
        Variables: {
            session: Session<SessionData>,
        }
    }>()

    const store = new CookieStore()

    // AI : CORS configuration
    app.use('*', cors({
        origin: config.corsOrigin,
        credentials: true
    }));

    // AI : Session middleware
    app.use('*', sessionMiddleware({
        store,
        sessionCookieName: 'session',
        encryptionKey: config.sessionEncryptionKey,
        expireAfterSeconds: 900,
    }) as any)

    // AI : Create tRPC router with provided database instance
    const appRouter = await createAppRouter(config.database);

    // AI : tRPC server with superjson transformer
    app.use('/trpc/*', trpcServer({
        router: appRouter,
        createContext(_opts: any, c: any) {
            return {
                session: c.get('session')
            };
        }
    }));

    // AI : File upload endpoint for images
    app.post('/api/upload-image', async (c) => {
        try {
            const body = await c.req.formData();
            const file = body.get('image') as File;

            if (!file) {
                return c.json({ error: 'No file provided' } as FileUploadError, 400);
            }

            const maxFileSize = 10 * 1024 * 1024;
            if (file.size > maxFileSize) {
                return c.json({ error: 'File too large. Maximum size is 10MB' } as FileUploadError, 400);
            }

            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
            if (!allowedTypes.includes(file.type)) {
                return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed' } as FileUploadError, 400);
            }
            
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const fileExtension = file.name.split('.').pop() ?? 'webp';
            const filename = `${timestamp}-${randomString}.${fileExtension}`;
            
            const buffer = await file.arrayBuffer();
            await config.storage.put(filename, buffer);
            
            // AI : Use direct R2 URL in production, local URL for development
            const imageUrl = config.isProduction && config.r2PublicUrl
                ? `${config.r2PublicUrl}/${filename}`
                : `/uploads/${filename}`;
            
            return c.json({ 
                success: true, 
                filename: filename,
                url: imageUrl
            } as FileUploadResult);
        } catch (error) {
            console.error('Error uploading file:', error);
            return c.json({ error: 'Failed to upload file' } as FileUploadError, 500);
        }
    });

    // AI : Serve uploaded files - only for local development
    app.get('/uploads/*', async (c) => {
        try {
            const filename = c.req.path.replace('/uploads/', '');
            const file = await config.storage.get(filename);
            
            if (file) {
                return new Response(file.body, {
                    headers: {
                        'Content-Type': file.contentType ?? 'application/octet-stream',
                        'Cache-Control': 'public, max-age=31536000'
                    }
                });
            }
            
            return c.json({ error: 'File not found' }, 404);
        } catch (error) {
            console.error('Error serving file:', error);
            return c.json({ error: 'Failed to serve file' }, 500);
        }
    });

    // AI : Session check endpoint
    app.get('/api/check-session', (c) => {
        const session = c.get('session')
        return c.json({
            userId: session.get('userId'),
            isAuthenticated: session.get('isAuthenticated'),
            username: session.get('username')
        });
    });

    // AI : Health check endpoint
    app.get('/api/health', (c) => {
        return c.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    return { app, appRouter };
}

export type AppRouter = Awaited<ReturnType<typeof createSharedApp>>['appRouter'];