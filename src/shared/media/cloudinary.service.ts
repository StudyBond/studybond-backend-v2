import { MEDIA_CONFIG } from '../../config/constants';
import { AppError } from '../errors/AppError';

export interface CloudinaryUploadedImageAsset {
  provider: 'CLOUDINARY';
  url: string;
  publicId: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  originalFilename: string | null;
}

interface UploadImageBufferInput {
  buffer: Buffer;
  filename: string;
  contentType?: string;
  folder: string;
}

interface ImportRemoteImageInput {
  sourceUrl: string;
  folder: string;
}

interface CloudinaryUploadResponse {
  secure_url?: string;
  public_id?: string;
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
  original_filename?: string;
  error?: {
    message?: string;
  };
}

interface CloudinaryDestroyResponse {
  result?: string;
  error?: {
    message?: string;
  };
}

function createBasicAuthHeader(): string {
  const credentials = `${MEDIA_CONFIG.CLOUDINARY_API_KEY}:${MEDIA_CONFIG.CLOUDINARY_API_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

function buildUploadUrl(path: 'upload' | 'destroy'): string {
  return `${MEDIA_CONFIG.CLOUDINARY_BASE_URL}/${MEDIA_CONFIG.CLOUDINARY_CLOUD_NAME}/image/${path}`;
}

function buildManagedFolder(folder: string): string {
  const normalizedBase = MEDIA_CONFIG.CLOUDINARY_UPLOAD_FOLDER.replace(/^\/+|\/+$/g, '');
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');

  return normalizedBase ? `${normalizedBase}/${normalizedFolder}` : normalizedFolder;
}

function createAbortSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

async function parseCloudinaryJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}

function ensureUploadConfigured(): void {
  if (!MEDIA_CONFIG.CLOUDINARY_ENABLED) {
    throw new AppError(
      'Cloudinary is not configured for question image management.',
      503,
      'MEDIA_PROVIDER_NOT_CONFIGURED'
    );
  }
}

function buildUploadResult(payload: CloudinaryUploadResponse): CloudinaryUploadedImageAsset {
  if (!payload.secure_url || !payload.public_id) {
    throw new AppError(
      'Cloudinary upload completed without the expected asset identifiers.',
      502,
      'MEDIA_PROVIDER_INVALID_RESPONSE'
    );
  }

  return {
    provider: 'CLOUDINARY',
    url: payload.secure_url,
    publicId: payload.public_id,
    bytes: typeof payload.bytes === 'number' ? payload.bytes : null,
    width: typeof payload.width === 'number' ? payload.width : null,
    height: typeof payload.height === 'number' ? payload.height : null,
    format: payload.format || null,
    originalFilename: payload.original_filename || null
  };
}

export class CloudinaryMediaService {
  isConfigured(): boolean {
    return MEDIA_CONFIG.CLOUDINARY_ENABLED;
  }

  async uploadImageBuffer(input: UploadImageBufferInput): Promise<CloudinaryUploadedImageAsset> {
    ensureUploadConfigured();

    const fileBytes = Uint8Array.from(input.buffer);
    const body = new FormData();
    body.set('file', new Blob([fileBytes], { type: input.contentType || 'application/octet-stream' }), input.filename);
    body.set('folder', buildManagedFolder(input.folder));
    body.set('use_filename', 'true');
    body.set('unique_filename', 'true');
    body.set('overwrite', 'false');

    const response = await fetch(buildUploadUrl('upload'), {
      method: 'POST',
      headers: {
        Authorization: createBasicAuthHeader()
      },
      body,
      signal: createAbortSignal(MEDIA_CONFIG.CLOUDINARY_UPLOAD_TIMEOUT_MS)
    });

    const payload = await parseCloudinaryJson(response) as CloudinaryUploadResponse;
    if (!response.ok) {
      throw new AppError(
        payload.error?.message || 'Cloudinary rejected the uploaded image.',
        response.status >= 500 ? 503 : 502,
        'MEDIA_UPLOAD_FAILED'
      );
    }

    return buildUploadResult(payload);
  }

  async importRemoteImage(input: ImportRemoteImageInput): Promise<CloudinaryUploadedImageAsset> {
    ensureUploadConfigured();

    const body = new FormData();
    body.set('file', input.sourceUrl);
    body.set('folder', buildManagedFolder(input.folder));
    body.set('use_filename', 'true');
    body.set('unique_filename', 'true');
    body.set('overwrite', 'false');

    const response = await fetch(buildUploadUrl('upload'), {
      method: 'POST',
      headers: {
        Authorization: createBasicAuthHeader()
      },
      body,
      signal: createAbortSignal(MEDIA_CONFIG.CLOUDINARY_UPLOAD_TIMEOUT_MS)
    });

    const payload = await parseCloudinaryJson(response) as CloudinaryUploadResponse;
    if (!response.ok) {
      throw new AppError(
        payload.error?.message || 'Cloudinary could not import the remote image.',
        response.status >= 500 ? 503 : 502,
        'MEDIA_UPLOAD_FAILED'
      );
    }

    return buildUploadResult(payload);
  }

  async destroyImage(publicId: string): Promise<void> {
    if (!publicId) return;
    ensureUploadConfigured();

    const body = new FormData();
    body.set('public_id', publicId);
    body.set('invalidate', 'true');

    const response = await fetch(buildUploadUrl('destroy'), {
      method: 'POST',
      headers: {
        Authorization: createBasicAuthHeader()
      },
      body,
      signal: createAbortSignal(MEDIA_CONFIG.CLOUDINARY_UPLOAD_TIMEOUT_MS)
    });

    const payload = await parseCloudinaryJson(response) as CloudinaryDestroyResponse;
    if (!response.ok) {
      throw new AppError(
        payload.error?.message || 'Cloudinary could not delete the image.',
        response.status >= 500 ? 503 : 502,
        'MEDIA_DELETE_FAILED'
      );
    }

    if (payload.result !== 'ok' && payload.result !== 'not found') {
      throw new AppError(
        `Cloudinary returned an unexpected destroy result: ${payload.result || 'unknown'}.`,
        502,
        'MEDIA_PROVIDER_INVALID_RESPONSE'
      );
    }
  }
}

export const cloudinaryMediaService = new CloudinaryMediaService();
