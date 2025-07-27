import { StorageInterface } from './types';

// AI : Cloudflare Images service for production
export class CloudflareImagesStorage implements StorageInterface {
  constructor(
    private accountId: string,
    private apiToken: string,
    private deliveryUrl: string
  ) {}

  async put(filename: string, buffer: ArrayBuffer): Promise<void> {
    const formData = new FormData();
    formData.append('file', new Blob([buffer]));
    formData.append('id', filename);

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to upload to Cloudflare Images: ${response.statusText}`);
    }
  }

  async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      const imageUrl = `${this.deliveryUrl}/${filename}/public`;
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        return null;
      }

      return {
        body: response.body!,
        contentType: response.headers.get('content-type') || 'image/jpeg'
      };
    } catch {
      return null;
    }
  }
}

// AI : Enhanced R2 storage with image optimization
export class EnhancedR2Storage implements StorageInterface {
  constructor(private bucket: R2Bucket) {}

  async put(filename: string, buffer: ArrayBuffer): Promise<void> {
    // AI : Store original in R2
    await this.bucket.put(filename, buffer);
  }

  async get(filename: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
    try {
      const object = await this.bucket.get(filename);
      if (!object) {
        return null;
      }
      
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType
      };
    } catch {
      return null;
    }
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }
}
