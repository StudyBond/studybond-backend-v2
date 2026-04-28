import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

async function loadCloudinaryService() {
  vi.resetModules();
  return import('../../shared/media/cloudinary.service');
}

describe('cloudinary media service', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      CLOUDINARY_CLOUD_NAME: 'studybond-cloud',
      CLOUDINARY_API_KEY: 'cloudinary-key',
      CLOUDINARY_API_SECRET: 'cloudinary-secret',
      CLOUDINARY_UPLOAD_FOLDER: 'studybond',
      CLOUDINARY_UPLOAD_TIMEOUT_MS: '1000'
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('uploads buffered images into the configured Cloudinary folder prefix', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(200, {
      secure_url: 'https://res.cloudinary.com/studybond-cloud/image/upload/v1/studybond/questions/prompts/question.png',
      public_id: 'studybond/questions/prompts/question',
      bytes: 3210,
      width: 640,
      height: 360,
      format: 'png',
      original_filename: 'question'
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { cloudinaryMediaService } = await loadCloudinaryService();
    const result = await cloudinaryMediaService.uploadImageBuffer({
      buffer: Buffer.from('image-bytes'),
      filename: 'question.png',
      contentType: 'image/png',
      folder: 'questions/prompts'
    });

    expect(result).toEqual(expect.objectContaining({
      provider: 'CLOUDINARY',
      publicId: 'studybond/questions/prompts/question'
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/studybond-cloud/image/upload');
    expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

    const body = init?.body as FormData;
    expect(body.get('folder')).toBe('studybond/questions/prompts');
    expect(body.get('use_filename')).toBe('true');
    expect(body.get('overwrite')).toBe('false');
  });

  it('destroys uploaded images and treats not-found responses as safe cleanup', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(200, {
      result: 'not found'
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { cloudinaryMediaService } = await loadCloudinaryService();
    await expect(
      cloudinaryMediaService.destroyImage('studybond/questions/prompts/question')
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = init?.body as FormData;
    expect(body.get('public_id')).toBe('studybond/questions/prompts/question');
    expect(body.get('invalidate')).toBe('true');
  });
});
