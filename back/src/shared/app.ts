import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Session, sessionMiddleware, CookieStore } from 'hono-sessions'
import { AppConfig, SessionData, FileUploadResult, FileUploadError } from './types';
import { createCloudflareDb } from './cloudflare-db';
import { createAppRouter } from './routers';
import { trpcServer } from '@hono/trpc-server';

// AI : Create Hono application with conditional tRPC support
export async function createApp(config: AppConfig) {
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

    // AI : Setup tRPC with Supabase if database URL is provided (Workers context)
    let appRouter: any = null;
    
    if (config.databaseUrl && !config.databaseUrl.includes('your-project.supabase.co')) {
        try {
            console.log('AI : Setting up tRPC with Supabase for Workers...');
            
            // AI : Create database instance for Cloudflare Workers
            const workersDb = createCloudflareDb(config.databaseUrl);
            
            // AI : Test the database connection first
            await workersDb.execute('SELECT 1');
            
            // AI : Create tRPC router with database injection (now async)
            appRouter = await createAppRouter(workersDb);

            // AI : tRPC server with superjson transformer
            app.use('/trpc/*', trpcServer({
                router: appRouter,
                createContext(_opts: any, c: any) {
                    return {
                        session: c.get('session')
                    };
                }
            }));

            console.log('AI : tRPC routes enabled for Workers with Supabase');
        } catch (error) {
            console.error('AI : Failed to setup tRPC in Workers:', error);
            console.log('AI : Creating router without database');
            
            // AI : Create router without database for fallback
            appRouter = await createAppRouter();
            
            app.use('/trpc/*', trpcServer({
                router: appRouter,
                createContext(_opts: any, c: any) {
                    return {
                        session: c.get('session')
                    };
                }
            }));
        }
    } else {
        console.log('AI : No valid database URL - creating router without database');
        
        // AI : Create router without database
        appRouter = await createAppRouter();
        
        app.use('/trpc/*', trpcServer({
            router: appRouter,
            createContext(_opts: any, c: any) {
                return {
                    session: c.get('session')
                };
            }
        }));
    }

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
            
            return c.json({ 
                success: true, 
                filename: filename,
                url: `/uploads/${filename}`
            } as FileUploadResult);
        } catch (error) {
            console.error('Error uploading file:', error);
            return c.json({ error: 'Failed to upload file' } as FileUploadError, 500);
        }
    });

    // AI : Serve uploaded files
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

export type AppRouter = Awaited<ReturnType<typeof createAppRouter>>;