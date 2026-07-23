/**
 * Utility to intelligently parse raw topic strings from database into
 * structured Topic Families and Subtopics.
 *
 * Example input -> output:
 * - "Phonology — Word Stress" -> { rawTopic: "Phonology — Word Stress", topicFamily: "Phonology", subtopic: "Word Stress" }
 * - "Phonology - Vowels"     -> { rawTopic: "Phonology - Vowels", topicFamily: "Phonology", subtopic: "Vowels" }
 * - "Algebra"                -> { rawTopic: "Algebra", topicFamily: "Algebra", subtopic: null }
 */

export type ParsedTopic = {
    rawTopic: string;
    topicFamily: string;
    subtopic: string | null;
};

export function parseTopicString(rawTopic: string | null | undefined): ParsedTopic {
    if (!rawTopic || !rawTopic.trim()) {
        return {
            rawTopic: 'General',
            topicFamily: 'General',
            subtopic: null
        };
    }

    const clean = rawTopic.trim();

    // Split on em-dash (—), en-dash (–), colon (:), or hyphens surrounded by spaces
    // Regex covers Unicode dash characters \u2014, \u2013, \u2015, \u2212 and ASCII hyphen -
    const parts = clean.split(/\s*[\u2014\u2013\u2015\:]\s*|\s+[\-\u2212]\s+/);

    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        const topicFamily = cleanTitleCase(parts[0].trim());
        const subtopic = cleanTitleCase(parts.slice(1).join(' - ').trim());
        return {
            rawTopic: clean,
            topicFamily,
            subtopic
        };
    }

    return {
        rawTopic: clean,
        topicFamily: cleanTitleCase(clean),
        subtopic: null
    };
}

function cleanTitleCase(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).trim();
}
