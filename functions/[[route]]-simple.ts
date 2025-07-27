import { handle } from 'hono/cloudflare-pages'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import './types'; // AI : Import Cloudflare types

// AI : Cloudflare Pages environment bindings
interface Env {
    R2_BUCKET?: R2Bucket;
    DATABASE_URL: string;
    SESSION_ENCRYPTION_KEY: string;
    CORS_ORIGIN: string;
}

// AI : Simple test app for Cloudflare Pages
const app = new Hono<{ Bindings: Env }>()

// AI : CORS configuration
app.use('*', cors({
    origin: ['https://construction-map.pages.dev', 'http://localhost:8788', 'http://localhost:5173'],
    credentials: true
}));

// AI : Simple health check
app.get('/api/health', (c) => {
    return c.json({
        status: 'ok',
        message: 'Cloudflare Pages Functions working!',
        environment: {
            hasR2: !!c.env.R2_BUCKET,
            hasDatabase: !!c.env.DATABASE_URL,
            hasSessionKey: !!c.env.SESSION_ENCRYPTION_KEY
        }
    });
});

// AI : Simple file upload test (without database)
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

        // AI : Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = file.name.split('.').pop() ?? 'webp';
        const filename = `${timestamp}-${randomString}.${fileExtension}`;
        
        const buffer = await file.arrayBuffer();
        
        // AI : Store in R2 if available
        if (c.env.R2_BUCKET) {
            await c.env.R2_BUCKET.put(filename, buffer);
            return c.json({ 
                success: true, 
                filename: filename,
                url: `/uploads/${filename}`
            });
        } else {
            return c.json({ error: 'R2 storage not configured' }, 500);
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        return c.json({ error: 'Failed to upload file' }, 500);
    }
});

// AI : Serve uploaded files from R2
app.get('/uploads/*', async (c) => {
    try {
        const filename = c.req.path.replace('/uploads/', '');
        if (c.env.R2_BUCKET) {
            const object = await c.env.R2_BUCKET.get(filename);
            if (object) {
                return new Response(object.body, {
                    headers: {
                        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
                        'Cache-Control': 'public, max-age=31536000'
                    }
                });
            }
        }
        return c.json({ error: 'File not found' }, 404);
    } catch (error) {
        console.error('Error serving file:', error);
        return c.json({ error: 'Failed to serve file' }, 500);
    }
});

// AI : Export the handler for Cloudflare Pages
export const onRequest = handle(app);
