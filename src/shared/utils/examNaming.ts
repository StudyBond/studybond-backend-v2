import { EXAM_TYPES } from '../../modules/exams/exams.constants';

const SUBJECT_ORDER = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'English'] as const;

const SUBJECT_CODES: Record<string, string> = {
  Biology: 'BIO',
  Chemistry: 'CHM',
  Physics: 'PHY',
  Mathematics: 'MTH',
  English: 'ENG'
};

type ExamMode = 'REAL' | 'PRACTICE' | 'MIXED' | 'DAILY' | 'DUEL' | 'GROUP';

export interface NamingResult {
  scopeKey: string;
  displayNameLong: string;
  displayNameShort: string;
}

function mapExamTypeToMode(examType: string): ExamMode {
  if (examType === EXAM_TYPES.REAL_PAST_QUESTION) return 'REAL';
  if (examType === EXAM_TYPES.PRACTICE) return 'PRACTICE';
  if (examType === EXAM_TYPES.MIXED) return 'MIXED';
  if (examType === EXAM_TYPES.DAILY_CHALLENGE) return 'DAILY';
  if (examType === EXAM_TYPES.ONE_V_ONE_DUEL) return 'DUEL';
  return 'GROUP';
}

function modePrefixes(mode: ExamMode): { longPrefix: string; shortPrefix: string } {
  if (mode === 'REAL') {
    return { longPrefix: 'UI Real Mode', shortPrefix: 'UI Real' };
  }
  if (mode === 'PRACTICE') {
    return { longPrefix: 'UI Simulation', shortPrefix: 'UI Sim' };
  }
  if (mode === 'MIXED') {
    return { longPrefix: 'UI Mixed Mode', shortPrefix: 'UI Mix' };
  }
  if (mode === 'DAILY') {
    return {
      longPrefix: 'Daily Challenge',
      shortPrefix: '#Daily',
    };
  }
  if (mode === 'DUEL') {
    return { longPrefix: 'UI Duel', shortPrefix: 'UI Duel' };
  }
  return { longPrefix: 'UI Group', shortPrefix: 'UI Group' };
}

export function canonicalizeSubjects(subjects: string[]): string[] {
  const unique = Array.from(new Set(subjects));
  return unique.sort((a, b) => {
    const aOrder = SUBJECT_ORDER.indexOf(a as any);
    const bOrder = SUBJECT_ORDER.indexOf(b as any);
    if (aOrder === -1 && bOrder === -1) return a.localeCompare(b);
    if (aOrder === -1) return 1;
    if (bOrder === -1) return -1;
    return aOrder - bOrder;
  });
}

export function isFullExamSelection(subjects: string[]): boolean {
  const normalized = canonicalizeSubjects(subjects);
  return normalized.length === 4 && normalized.includes('English');
}

export function toSubjectCode(subject: string): string {
  return SUBJECT_CODES[subject] || subject.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'UNK';
}

function padSession(sessionNumber: number): string {
  return `${sessionNumber}`.padStart(3, '0');
}

function buildSubjectBlocks(subjects: string[]): { longBlock: string; shortBlock: string; signature: string } {
  const normalized = canonicalizeSubjects(subjects);
  if (isFullExamSelection(normalized)) {
    return {
      longBlock: 'Full Exam',
      shortBlock: 'Full',
      signature: 'FULL'
    };
  }

  const longBlock = normalized.join('/');
  const shortCodes = normalized.map((subject) => toSubjectCode(subject));
  const shortBlock = shortCodes.join('/');
  const signature = shortCodes.join('|');

  return {
    longBlock,
    shortBlock,
    signature
  };
}

export function buildScopeKeyFromExamType(examType: string, subjects: string[]): string {
  const mode = mapExamTypeToMode(examType);
  const { signature } = buildSubjectBlocks(subjects);
  return `${mode}:${signature}`;
}

export function buildExamDisplayNames(
  examType: string,
  subjects: string[],
  sessionNumber: number
): NamingResult {
  const mode = mapExamTypeToMode(examType);
  const { longPrefix, shortPrefix } = modePrefixes(mode);
  const { longBlock, shortBlock, signature } = buildSubjectBlocks(subjects);
  const padded = padSession(sessionNumber);

  return {
    scopeKey: `${mode}:${signature}`,
    displayNameLong: `${longPrefix} • ${longBlock} • Session ${padded}`,
    displayNameShort: `${shortPrefix} • ${shortBlock} • S${padded}`
  };
}

export function buildCollabDisplayNames(
  sessionType: string,
  subjects: string[],
  sessionNumber: number,
  customName?: string | null
): NamingResult & { effectiveDisplayName: string } {
  const mode: ExamMode = sessionType === EXAM_TYPES.ONE_V_ONE_DUEL ? 'DUEL' : 'GROUP';
  const { longPrefix, shortPrefix } = modePrefixes(mode);
  const { longBlock, shortBlock, signature } = buildSubjectBlocks(subjects);
  const padded = padSession(sessionNumber);

  const displayNameLong = `${longPrefix} • ${longBlock} • Session ${padded}`;
  const displayNameShort = `${shortPrefix} • ${shortBlock} • S${padded}`;

  return {
    scopeKey: `${mode}:${signature}`,
    displayNameLong,
    displayNameShort,
    effectiveDisplayName: customName && customName.trim().length > 0 ? customName.trim() : displayNameLong
  };
}
