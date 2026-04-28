const SUBJECT_CANONICAL_MAP: Record<string, string> = {
  english: 'English',
  'english language': 'English',
  'use of english': 'English',
  mathematics: 'Mathematics',
  maths: 'Mathematics',
  math: 'Mathematics',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology'
};

const SUBJECT_SEARCH_VARIANTS: Record<string, string[]> = {
  English: ['English', 'English Language', 'Use of English'],
  Mathematics: ['Mathematics', 'Maths', 'Math'],
  Physics: ['Physics'],
  Chemistry: ['Chemistry'],
  Biology: ['Biology']
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeSubjectLabel(subject?: string | null): string {
  const trimmed = typeof subject === 'string' ? normalizeWhitespace(subject) : '';
  if (!trimmed) {
    return '';
  }

  return SUBJECT_CANONICAL_MAP[trimmed.toLowerCase()] ?? trimmed;
}

export function getSubjectSearchVariants(subject?: string | null): string[] {
  const canonical = normalizeSubjectLabel(subject);
  if (!canonical) {
    return [];
  }

  return Array.from(new Set(SUBJECT_SEARCH_VARIANTS[canonical] ?? [canonical]));
}
