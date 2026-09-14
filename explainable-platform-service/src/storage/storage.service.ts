import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';
import type { Readable } from 'node:stream';
import { LocalStorageDriver } from './local-storage.driver';

/**
 * Storage service backed by Google Cloud Storage.
 *
 * Auth model:
 *   - On GCE, uses Application Default Credentials (compute SA).
 *   - The compute SA must have:
 *       roles/storage.objectAdmin on the bucket           (for read/write)
 *       roles/iam.serviceAccountTokenCreator on itself    (for getSignedUrl V4)
 *
 * Object layout:
 *   gs://{GCS_BUCKET}/{GCS_PREDICTIONS_PREFIX}/{path}/{fileName}
 *
 * Public API kept identical to the previous AWS S3 implementation
 * (uploadToS3 / getPresignedUrl) to avoid touching every call site.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storage?: Storage;
  private readonly bucket?: Bucket;
  /** Set when no bucket is configured; see LocalStorageDriver. */
  private readonly local?: LocalStorageDriver;
  private readonly bucketName: string;
  private readonly prefix: string;
  private readonly signedUrlTtlSec: number;

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.get<string>('GCS_BUCKET') ?? '';
    this.prefix =
      this.configService.get<string>('GCS_PREDICTIONS_PREFIX') ?? 'predictions';
    this.signedUrlTtlSec = parseInt(
      this.configService.get<string>('GCS_SIGNED_URL_TTL_SEC') ?? '3600',
      10,
    );

    if (this.bucketName) {
      // Storage() uses ADC: on GCE, picks up the compute service account automatically.
      this.storage = new Storage();
      this.bucket = this.storage.bucket(this.bucketName);
    } else {
      const root =
        this.configService.get<string>('LOCAL_STORAGE_DIR') ?? '.local-storage';
      this.local = new LocalStorageDriver(root);
      this.logger.warn(
        `GCS_BUCKET is not set — storing objects under ${root} instead. ` +
          'Suitable for local development only; signed URLs are unavailable, so ' +
          'the PNG plots will not render.',
      );
    }
  }

  /**
   * Upload a base64-encoded PNG to GCS at:
   *   {prefix}/{path}/{fileName}
   *
   * Returns the object key (NOT a URL). Pair with getPresignedUrl() to render in browser.
   *
   * Throws on failure. Earlier this method swallowed errors and returned ''
   * — which made an upload failure indistinguishable from "no image". The
   * caller now needs to tell those apart (to mark UPLOAD_FAILED vs
   * IMAGE_FAILED), so the error is propagated.
   */
  async uploadToS3(
    base64Data: string,
    path: string,
    fileName: string,
  ): Promise<string> {
    const buffer = Buffer.from(base64Data, 'base64');
    const key = `${this.prefix}/${path}/${fileName}`;
    if (this.local) return this.local.save(key, buffer);
    try {
      await this.bucket!.file(key).save(buffer, {
        contentType: 'image/png',
        resumable: false,
        metadata: {
          cacheControl: 'private, max-age=0, no-transform',
        },
      });
      return key;
    } catch (error) {
      this.logger.error(`uploadToS3 failed for ${key}`, error as Error);
      throw error;
    }
  }

  /**
   * Store an already-gzipped JSON payload.
   *
   * Deliberately separate from uploadToS3(), which takes base64 and hardcodes
   * image/png. Storing the bytes gzipped and serving them through with
   * `Content-Encoding: gzip` avoids a decompress/recompress hop on every read.
   */
  async uploadJsonGzip(
    gzipped: Buffer,
    path: string,
    fileName: string,
  ): Promise<string> {
    const key = `${this.prefix}/${path}/${fileName}`;
    if (this.local) return this.local.save(key, gzipped);
    try {
      await this.bucket!.file(key).save(gzipped, {
        contentType: 'application/json',
        resumable: false,
        metadata: {
          // contentEncoding belongs to the object's metadata, not to SaveOptions.
          // Setting it here is what lets the bytes be served through to the browser
          // still compressed.
          contentEncoding: 'gzip',
          cacheControl: 'private, max-age=0, must-revalidate',
        },
      });
      return key;
    } catch (error) {
      this.logger.error(`uploadJsonGzip failed for ${key}`, error as Error);
      throw error;
    }
  }

  /**
   * Stream stored bytes straight to the response, exactly as stored.
   *
   * `decompress: false` matters for the gzipped payloads: the client asks GCS for
   * gzip and, left to its default, gunzips what comes back — so the response
   * would carry `Content-Encoding: gzip` over plain JSON.
   */
  createReadStream(key: string): Readable {
    if (this.local) return this.local.createReadStream(key);
    return this.bucket!.file(key).createReadStream({ decompress: false });
  }

  /** Read a stored object into memory, still compressed if it was stored so. */
  async download(key: string): Promise<Buffer> {
    if (this.local) return this.local.download(key);
    const [contents] = await this.bucket!.file(key).download({
      decompress: false,
    });
    return contents;
  }

  /**
   * Generate a V4 signed URL for read access (default TTL: 1 hour).
   *
   * Requires the compute SA to have roles/iam.serviceAccountTokenCreator
   * on itself, OR a service account JSON key via GOOGLE_APPLICATION_CREDENTIALS.
   */
  async getPresignedUrl(key: string): Promise<string> {
    if (!key) return '';
    if (this.local) {
      // No equivalent locally. Returning '' makes the image render as "not
      // available" rather than as a broken link.
      return '';
    }
    const [url] = await this.bucket!.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + this.signedUrlTtlSec * 1000,
    });
    return url;
  }
}
