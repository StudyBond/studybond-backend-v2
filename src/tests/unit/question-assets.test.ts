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

async function loadQuestionAssets() {
  vi.resetModules();
  return import('../../modules/questions/question-assets');
}

describe('question asset helpers', () => {
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

  it('imports external question images into Cloudinary when no public id is supplied', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(200, {
      secure_url: 'https://res.cloudinary.com/studybond-cloud/image/upload/v1/studybond/questions/prompts/remote-question.png',
      public_id: 'studybond/questions/prompts/remote-question',
      bytes: 2048,
      width: 300,
      height: 200,
      format: 'png',
      original_filename: 'remote-question'
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { resolveManagedQuestionAsset } = await loadQuestionAssets();
    const resolved = await resolveManagedQuestionAsset({
      url: 'https://example.com/question.png'
    }, 'question');

    expect(resolved.url).toBe('https://res.cloudinary.com/studybond-cloud/image/upload/v1/studybond/questions/prompts/remote-question.png');
    expect(resolved.publicId).toBe('studybond/questions/prompts/remote-question');
    expect(resolved.uploadedAsset?.provider).toBe('CLOUDINARY');
  });

  it('skips Cloudinary import when media storage is not configured', async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { resolveManagedQuestionAsset } = await loadQuestionAssets();
    const resolved = await resolveManagedQuestionAsset({
      url: 'https://example.com/question.png'
    }, 'question');

    expect(resolved).toEqual({
      url: 'https://example.com/question.png',
      publicId: null,
      uploadedAsset: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplicates public ids during cleanup', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(200, {
      result: 'ok'
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { cleanupQuestionAssets } = await loadQuestionAssets();
    await cleanupQuestionAssets([
      'studybond/questions/prompts/question-1',
      'studybond/questions/prompts/question-1',
      'studybond/questions/prompts/question-2'
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
