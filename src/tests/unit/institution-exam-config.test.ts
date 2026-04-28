import { describe, expect, it } from 'vitest';
import { institutionExamConfigService } from '../../shared/institutions/exam-config';

describe('InstitutionExamConfigService', () => {
  it('falls back to legacy defaults when an institution has no config row yet', async () => {
    const config = await institutionExamConfigService.getActiveConfigForInstitutionId(42, {
      institutionExamConfig: {
        findFirst: async () => null
      }
    });

    expect(config.institutionId).toBe(42);
    expect(config.trackCode).toBe('POST_UTME');
    expect(config.questionsPerSubject).toBe(25);
    expect(config.fullExamQuestions).toBe(100);
    expect(config.defaultFullExamSource).toBe('REAL_PAST_QUESTION');
    expect(config.defaultPartialExamSource).toBe('MIXED');
    expect(config.allowMixedPartialExams).toBe(true);
    expect(config.allowMixedFullExams).toBe(false);
  });
});
