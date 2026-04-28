import { cloudinaryMediaService, CloudinaryUploadedImageAsset } from '../../shared/media/cloudinary.service';

export const QUESTION_ASSET_KINDS = [
  'question',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'optionE',
  'explanation'
] as const;

export type QuestionAssetKind = typeof QUESTION_ASSET_KINDS[number];

export interface QuestionAssetUploadInput {
  kind: QuestionAssetKind;
  buffer: Buffer;
  filename: string;
  contentType?: string;
}

export interface ManagedQuestionAssetInput {
  url?: string | null;
  publicId?: string | null;
}

export interface ResolvedManagedQuestionAsset {
  url: string | null;
  publicId: string | null;
  uploadedAsset: CloudinaryUploadedImageAsset | null;
}

function buildQuestionAssetFolder(kind: QuestionAssetKind): string {
  switch (kind) {
    case 'question':
      return 'questions/prompts';
    case 'optionA':
    case 'optionB':
    case 'optionC':
    case 'optionD':
    case 'optionE':
      return `questions/options/${kind.toLowerCase()}`;
    case 'explanation':
      return 'questions/explanations';
  }
}

export async function uploadQuestionAssetFile(
  input: QuestionAssetUploadInput
): Promise<CloudinaryUploadedImageAsset> {
  return cloudinaryMediaService.uploadImageBuffer({
    buffer: input.buffer,
    filename: input.filename,
    contentType: input.contentType,
    folder: buildQuestionAssetFolder(input.kind)
  });
}

export async function resolveManagedQuestionAsset(
  input: ManagedQuestionAssetInput,
  kind: QuestionAssetKind
): Promise<ResolvedManagedQuestionAsset> {
  const url = input.url?.trim() || null;
  const publicId = input.publicId?.trim() || null;

  if (!url) {
    return {
      url: null,
      publicId: null,
      uploadedAsset: null
    };
  }

  if (publicId) {
    return {
      url,
      publicId,
      uploadedAsset: null
    };
  }

  if (!cloudinaryMediaService.isConfigured()) {
    return {
      url,
      publicId: null,
      uploadedAsset: null
    };
  }

  const uploadedAsset = await cloudinaryMediaService.importRemoteImage({
    sourceUrl: url,
    folder: buildQuestionAssetFolder(kind)
  });

  return {
    url: uploadedAsset.url,
    publicId: uploadedAsset.publicId,
    uploadedAsset
  };
}

export async function cleanupQuestionAssets(publicIds: Array<string | null | undefined>): Promise<void> {
  if (!cloudinaryMediaService.isConfigured()) return;

  const uniquePublicIds = Array.from(
    new Set(publicIds.map((publicId) => publicId?.trim()).filter(Boolean))
  ) as string[];

  for (const publicId of uniquePublicIds) {
    try {
      await cloudinaryMediaService.destroyImage(publicId);
    } catch (error) {
      console.error(`Failed to clean up Cloudinary image ${publicId}:`, error);
    }
  }
}
