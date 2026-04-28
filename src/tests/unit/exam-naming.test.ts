import { describe, expect, it } from 'vitest';
import { EXAM_TYPES } from '../../modules/exams/exams.constants';
import {
  buildCollabDisplayNames,
  buildExamDisplayNames,
  buildScopeKeyFromExamType
} from '../../shared/utils/examNaming';

describe('examNaming utility', () => {
  it('formats real single-subject exam names correctly', () => {
    const naming = buildExamDisplayNames(EXAM_TYPES.REAL_PAST_QUESTION, ['Biology'], 14);
    expect(naming.scopeKey).toBe('REAL:BIO');
    expect(naming.displayNameLong).toBe('UI Real Mode • Biology • Session 014');
    expect(naming.displayNameShort).toBe('UI Real • BIO • S014');
  });

  it('formats practice full exam names correctly', () => {
    const naming = buildExamDisplayNames(
      EXAM_TYPES.PRACTICE,
      ['Mathematics', 'English', 'Biology', 'Physics'],
      27
    );
    expect(naming.scopeKey).toBe('PRACTICE:FULL');
    expect(naming.displayNameLong).toBe('UI Simulation • Full Exam • Session 027');
    expect(naming.displayNameShort).toBe('UI Sim • Full • S027');
  });

  it('formats mixed solo exam names correctly', () => {
    const naming = buildExamDisplayNames(EXAM_TYPES.MIXED, ['Biology'], 8);
    expect(naming.scopeKey).toBe('MIXED:BIO');
    expect(naming.displayNameLong).toBe('UI Mixed Mode • Biology • Session 008');
    expect(naming.displayNameShort).toBe('UI Mix • BIO • S008');
  });

  it('builds deterministic scope keys independent of input subject order', () => {
    const a = buildScopeKeyFromExamType(EXAM_TYPES.PRACTICE, ['Biology', 'Physics']);
    const b = buildScopeKeyFromExamType(EXAM_TYPES.PRACTICE, ['Physics', 'Biology']);
    expect(a).toBe('PRACTICE:BIO|PHY');
    expect(b).toBe(a);
  });

  it('uses custom collaboration name as effective display name', () => {
    const naming = buildCollabDisplayNames(
      EXAM_TYPES.ONE_V_ONE_DUEL,
      ['Biology', 'English'],
      3,
      'Med School Prep Duel'
    );
    expect(naming.scopeKey).toBe('DUEL:BIO|ENG');
    expect(naming.displayNameLong).toBe('UI Duel • Biology/English • Session 003');
    expect(naming.displayNameShort).toBe('UI Duel • BIO/ENG • S003');
    expect(naming.effectiveDisplayName).toBe('Med School Prep Duel');
  });
});
