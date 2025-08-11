// 0.6ms improvements on cloudflare versus intex.ts. it's ungly but for some reason it's faster
// there may be more improvements from tRPC edge runtimes adapters but it was unconclusive
// https://trpc.io/docs/server/adapters/fetch

// improvements are welcomed!

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Session, sessionMiddleware, CookieStore } from 'hono-sessions'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { initTRPC, lazy } from '@trpc/server'
import superjson from 'superjson'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from "postgres"
import * as schema from '../src/db/schema'
// AI : Router imports are now lazy loaded

// AI : Minimal worker with inlined dependencies for maximum performance
console.time('minimal-worker-init')

// AI : CPU time measurement utilities for Cloudflare Workers
interface CpuTimeTracker {
    start: number;
    measurements: { [key: string]: number };
    mark(label: string): void;
    getReport(): { totalTime: number; breakdown: { [key: string]: number } };
}

function createCpuTimeTracker(): CpuTimeTracker {
    const start = performance.now();
    const measurements: { [key: string]: number } = {};
    let lastMark = start;
    
    return {
        start,
        measurements,
        mark(label: string) {
            const now = performance.now();
            measurements[label] = now - lastMark;
            lastMark = now;
        },
        getReport() {
            const totalTime = performance.now() - start;
            return {
                totalTime,
                breakdown: { ...measurements }
            };
        }
    };
}

// AI : Inline tRPC setup
const t = initTRPC.context<{ session?: any }>().create({
    transformer: superjson,
});

const router = t.router;

// AI : Create router with lazy-loaded route files using tRPC's lazy function
function createMinimalRouter(db: any) {
    const routerStart = performance.now();
    console.time('minimal-router-creation');
    
    const routerCreationStart = performance.now();
    const minimalRouter = router({
        project: lazy(() => import('../src/routes/project').then(m => m.createProjectRouter(db))),
        moderation: lazy(() => import('../src/routes/moderation').then(m => m.createModerationRouter(db))),
        cities: lazy(() => import('../src/routes/cities').then(m => m.createCitiesRouter(db))),
        country: lazy(() => import('../src/routes/countries').then(m => m.createCountriesRouter(db))),
        overlay: lazy(() => import('../src/routes/overlay').then(m => m.createOverlayRouter(db))),
    });
    const routerCreationTime = performance.now() - routerCreationStart;
    
    console.timeEnd('minimal-router-creation');
    
    const totalRouterTime = performance.now() - routerStart;
    console.log(`Router Creation CPU Time: ${totalRouterTime.toFixed(2)}ms (creation: ${routerCreationTime.toFixed(2)}ms)`);
    
    return minimalRouter;
}

// AI : Inline database creation
function createDb(databaseUrl: string) {
    const dbStart = performance.now();
    console.time('minimal-db-creation');
    
    const clientStart = performance.now();
    const client = postgres(databaseUrl, {
        max: 1,
        fetch_types: false,
    });
    const clientTime = performance.now() - clientStart;
    
    const drizzleStart = performance.now();
    const db = drizzle(client, { schema });
    const drizzleTime = performance.now() - drizzleStart;
    
    console.timeEnd('minimal-db-creation');
    
    const totalDbTime = performance.now() - dbStart;
    console.log(`Database Creation CPU Time: ${totalDbTime.toFixed(2)}ms (client: ${clientTime.toFixed(2)}ms, drizzle: ${drizzleTime.toFixed(2)}ms)`);
    
    return db;
}

// AI : Inline storage classes
class MinimalR2Storage {
    constructor(private bucket: R2Bucket) {}
    async put(filename: string, buffer: ArrayBuffer): Promise<void> {
        await this.bucket.put(filename, buffer);
    }
    async get(filename: string) {
        const object = await this.bucket.get(filename);
        return object ? { body: object.body, contentType: object.httpMetadata?.contentType } : null;
    }
}

class MinimalLocalStorage {
    async put(filename: string, buffer: ArrayBuffer): Promise<void> {
        await Bun.write(`./uploads/${filename}`, buffer);
    }
    async get(filename: string) {
        try {
            const file = Bun.file(`./uploads/${filename}`);
            return await file.exists() ? { body: file.stream(), contentType: file.type } : null;
        } catch {
            return null;
        }
    }
}

console.timeEnd('minimal-worker-init');

// AI : Cloudflare Workers environment bindings
interface Env {
    ASSETS: { fetch: (request: Request) => Promise<Response> };
    R2_BUCKET?: R2Bucket;
    HYPERDRIVE?: Hyperdrive;
    SESSION_ENCRYPTION_KEY: string;
    CORS_ORIGIN?: string;
    R2_PUBLIC_URL?: string;
    DATABASE_URL?: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        console.time("now-in-trpc-cloudflare-worker-init");
        console.time('minimal-worker-total');
        const url = new URL(request.url);
        
        // AI : Initialize CPU time tracking only for tRPC routes
        const isTrpcRoute = url.pathname.startsWith('/trpc/');
        const cpuTracker = isTrpcRoute ? createCpuTimeTracker() : null;
        if (cpuTracker) cpuTracker.mark('request-start');
        
        try {
            // AI : Quick path for non-API requests
            if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/trpc/')) {
                let assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
                if (!assetPath.includes('.') && !assetPath.startsWith('/api/')) {
                    assetPath = '/index.html';
                }
                const assetRequest = new Request(`${url.origin}${assetPath}`, request);
                
                const response = await env.ASSETS.fetch(assetRequest);
                
                if (response.status === 404 && assetPath !== '/index.html') {
                    return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
                }
                
                return response;
            }

            // AI : Super fast health check
            if (url.pathname === '/api/health') {
                console.timeEnd('minimal-worker-total');
                return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
            }

            console.time('minimal-setup');
            if (cpuTracker) cpuTracker.mark('api-request-start');
            
            // AI : Minimal storage setup
            const storage = env.R2_BUCKET 
                ? new MinimalR2Storage(env.R2_BUCKET)
                : new MinimalLocalStorage();

            if (cpuTracker) cpuTracker.mark('storage-setup');

            // AI : Database URL resolution
            const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            const databaseUrl = (isLocal && (env.DATABASE_URL || process.env.DATABASE_URL))
                ? (env.DATABASE_URL ?? process.env.DATABASE_URL!)
                : env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? process.env.DATABASE_URL!;

            if (cpuTracker) cpuTracker.mark('database-url-resolution');

            console.log('Minimal. Using database URL:', databaseUrl);
            if (!databaseUrl) {
                throw new Error('No database connection available');
            }

            console.timeEnd('minimal-setup');
            if (cpuTracker) cpuTracker.mark('minimal-setup-complete');

            console.time('minimal-app-creation');
            
            // AI : Create database
            const db = createDb(databaseUrl);
            if (cpuTracker) cpuTracker.mark('database-creation');
            
            // AI : Create minimal Hono app
            const app = new Hono<{ Variables: { session: Session<any> } }>();
            if (cpuTracker) cpuTracker.mark('hono-app-creation');
            
            // AI : Minimal middleware
            app.use('*', cors({
                origin: env.CORS_ORIGIN ?? 'https://construction-map.leni-vienne2.workers.dev',
                credentials: true
            }));
            if (cpuTracker) cpuTracker.mark('cors-middleware');
            
            const store = new CookieStore();
            app.use('*', sessionMiddleware({
                store,
                sessionCookieName: 'session',
                encryptionKey: env.SESSION_ENCRYPTION_KEY ?? 'dev_key_for_local_development_only_32_chars_min',
                expireAfterSeconds: 900,
            }) as any);
            if (cpuTracker) cpuTracker.mark('session-middleware');
      
            // AI : Handle tRPC requests through Hono to maintain session context
            app.use('/trpc/*', async (c) => {
                const trpcStart = performance.now();
                const result = await fetchRequestHandler({
                    endpoint: '/trpc',
                    req: c.req.raw,
                    router: createMinimalRouter(db),
                    //createContext: () => ({ session: c.get('session') }), // TODO temporary to see if CPU time changes
                });
                const trpcTime = performance.now() - trpcStart;
                console.log(`TRPC Handler CPU Time: ${trpcTime.toFixed(2)}ms`);
                return result;
            });
            if (cpuTracker) cpuTracker.mark('trpc-handler-setup');

            // AI : Essential API endpoints
            app.get('/api/check-session', (c) => {
                const session = c.get('session');
                return c.json({
                    userId: session.get('userId'),
                    isAuthenticated: session.get('isAuthenticated'),
                    username: session.get('username')
                });
            });

            // AI : File upload endpoint for images
            app.post('/api/upload-image', async (c) => {
                try {
                    const body = await c.req.formData();
                    const file = body.get('image') as File;

                    if (!file) {
                        return c.json({ error: 'No file provided' }, 400);
                    }

                    const maxFileSize = 10 * 1024 * 1024;
                    if (file.size > maxFileSize) {
                        return c.json({ error: 'File too large. Maximum size is 10MB' }, 400);
                    }

                    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                    if (!allowedTypes.includes(file.type)) {
                        return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed' }, 400);
                    }
                    
                    const timestamp = Date.now();
                    const randomString = Math.random().toString(36).substring(2, 15);
                    const fileExtension = file.name.split('.').pop() ?? 'webp';
                    const filename = `${timestamp}-${randomString}.${fileExtension}`;
                    
                    const buffer = await file.arrayBuffer();
                    await storage.put(filename, buffer);
                    
                    // AI : Use direct R2 URL in production, local URL for development
                    const imageUrl = env.R2_PUBLIC_URL && !isLocal
                        ? `${env.R2_PUBLIC_URL}/${filename}`
                        : `/uploads/${filename}`;
                    
                    return c.json({ 
                        success: true, 
                        filename: filename,
                        url: imageUrl
                    });
                } catch (error) {
                    console.error('Error uploading file:', error);
                    return c.json({ error: 'Failed to upload file' }, 500);
                }
            });

            // AI : Serve uploaded files - only for local development
            app.get('/uploads/*', async (c) => {
                try {
                    const filename = c.req.path.replace('/uploads/', '');
                    const file = await storage.get(filename);
                    
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

            console.timeEnd('minimal-app-creation');
            if (cpuTracker) cpuTracker.mark('app-creation-complete');

            console.time('minimal-request-handling');
            const response = await app.fetch(request, env);
            console.timeEnd('minimal-request-handling');
            if (cpuTracker) cpuTracker.mark('request-handling-complete');
            
            console.timeEnd('minimal-worker-total');
            
            // AI : Generate and log comprehensive CPU time report only for tRPC routes
            if (cpuTracker) {
                const finalReport = cpuTracker.getReport();
                console.log('=== COMPREHENSIVE CPU TIME REPORT ===');
                console.log(`Total Request CPU Time: ${finalReport.totalTime.toFixed(2)}ms`);
                console.log('Breakdown:');
                Object.entries(finalReport.breakdown).forEach(([operation, time]) => {
                    console.log(`  ${operation}: ${time.toFixed(2)}ms`);
                });
                console.log('========================================');
            }
            
            return response;

        } catch (error) {
            if (cpuTracker) {
                const errorReport = cpuTracker.getReport();
                console.log('=== ERROR CPU TIME REPORT ===');
                console.log(`Total CPU Time Before Error: ${errorReport.totalTime.toFixed(2)}ms`);
                console.log('Breakdown:');
                Object.entries(errorReport.breakdown).forEach(([operation, time]) => {
                    console.log(`  ${operation}: ${time.toFixed(2)}ms`);
                });
                console.log('==============================');
            }
            
            console.error('Minimal worker error:', error);
            console.timeEnd('minimal-worker-total');
            return new Response('Internal Server Error', { status: 500 });
        }
    }
};