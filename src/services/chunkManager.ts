// Chunk Manager Service
// Split large documents into translation-friendly chunks

import type { Chunk } from '../types';

/**
 * Clause pattern for EN/ISO standards
 * Matches: 5, 5.1, 5.1.2, 5.1.2.3, A.1, B.2.3, etc.
 */
const CLAUSE_PATTERN = /^((?:\d+\.)*\d+|[A-Z]\.\d+(?:\.\d+)*)\s+/;

/**
 * Split text into chunks for translation
 * Uses clause-aware splitting for technical standards
 * Target: 500-1000 tokens per chunk
 */
export function splitIntoChunks(text: string, maxTokens: number = 800): Chunk[] {
    const chunks: Chunk[] = [];

    // Split into lines first
    const lines = text.split('\n');

    // Group lines into clause sections
    const sections: { clauseNumber: string | null; lines: string[] }[] = [];
    let currentSection: { clauseNumber: string | null; lines: string[] } = { clauseNumber: null, lines: [] };

    for (const line of lines) {
        const clauseMatch = line.match(CLAUSE_PATTERN);

        if (clauseMatch) {
            // New clause detected - save current section and start new one
            if (currentSection.lines.length > 0) {
                sections.push(currentSection);
            }
            currentSection = { clauseNumber: clauseMatch[1], lines: [line] };
        } else {
            // Continue current section
            currentSection.lines.push(line);
        }
    }

    // Don't forget the last section
    if (currentSection.lines.length > 0) {
        sections.push(currentSection);
    }

    // Now chunk each section
    let chunkPosition = 0;

    for (const section of sections) {
        const sectionText = section.lines.join('\n').trim();
        if (!sectionText) continue;

        const sectionTokens = estimateTokens(sectionText);

        if (sectionTokens <= maxTokens) {
            // Section fits in one chunk
            chunks.push(createChunk(sectionText, chunkPosition++, section.clauseNumber));
        } else {
            // Section too large - split by paragraphs within the section
            const paragraphs = sectionText.split(/\n\n+/).filter(p => p.trim());
            let currentChunkText = '';
            let isFirstParagraph = true;

            for (const paragraph of paragraphs) {
                const combinedTokens = estimateTokens(currentChunkText + '\n\n' + paragraph);

                if (currentChunkText && combinedTokens > maxTokens) {
                    // Save current chunk, start new one
                    chunks.push(createChunk(
                        currentChunkText,
                        chunkPosition++,
                        isFirstParagraph ? section.clauseNumber : null
                    ));
                    currentChunkText = paragraph;
                    isFirstParagraph = false;
                } else {
                    currentChunkText = currentChunkText
                        ? currentChunkText + '\n\n' + paragraph
                        : paragraph;
                }
            }

            // Add remaining text
            if (currentChunkText.trim()) {
                chunks.push(createChunk(
                    currentChunkText,
                    chunkPosition++,
                    isFirstParagraph ? section.clauseNumber : null
                ));
            }
        }
    }

    return chunks;
}

/**
 * Create a chunk object
 */
function createChunk(text: string, position: number, clauseNumber?: string | null): Chunk {
    const trimmedText = text.trim();
    const firstLine = trimmedText.split('\n')[0];

    // Detect chunk type using multiple signals
    const indicators = {
        // Markdown style Heading
        markdown: /^#{1,6}\s/.test(trimmedText),

        // Standard Numbered (1.2.3 Title)
        numbered: /^(\d+\.)+\d*\s+[A-Z]/.test(firstLine),

        // Capitalized Title Case (excluding single letters)
        capitalized: /^[A-Z][a-zA-Z\s]{2,}[^.!?]*$/.test(firstLine),

        // Short length (headings usually < 100 chars)
        short: firstLine.length < 100,

        // No sentence ending punctuation (unless it's a quote)
        noPunctuation: !/[.!?]$/.test(firstLine),

        // Explicit "Chapter"/"Section" start
        explicit: /^(Chapter|Section|Annex|Appendix)\s+\w+/i.test(firstLine)
    };

    // Calculate heading score
    let headingScore = 0;
    if (indicators.markdown) headingScore += 5; // Strongest signal
    if (indicators.explicit) headingScore += 5;
    if (indicators.numbered && indicators.short) headingScore += 3;
    if (indicators.capitalized && indicators.short && indicators.noPunctuation) headingScore += 2;

    // Clause number also indicates heading
    if (clauseNumber && indicators.short) headingScore += 3;

    // List detection
    const isList = /^[\-\*\u2022\d]+[\.\)]\s/.test(trimmedText) || trimmedText.startsWith('- ');

    // Table detection (Markdown style or many pipes)
    const tablePipeCount = (trimmedText.match(/\|/g) || []).length;
    const isTable = tablePipeCount > 4 && trimmedText.split('\n').filter(l => l.includes('|')).length > 2;

    let type: Chunk['type'] = 'paragraph';
    let metadata: Chunk['metadata'] = {};

    // Add clause number to metadata if present
    if (clauseNumber) {
        metadata.clauseNumber = clauseNumber;
    }

    if (headingScore >= 2) {
        type = 'heading';
        const headingMatch = trimmedText.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            metadata.level = headingMatch[1].length;
            metadata.heading = headingMatch[2];
        } else {
            // Infer level from clause number depth
            metadata.heading = firstLine.replace(/^#{1,6}\s+/, ''); // Clean up
            if (clauseNumber) {
                metadata.level = clauseNumber.split('.').length;
            } else {
                metadata.level = indicators.markdown ? (trimmedText.match(/^#+/)?.[0].length || 2) : 2;
            }
        }
    } else if (isList) {
        type = 'list';
    } else if (isTable) {
        type = 'table';
    }

    return {
        id: `chunk_${position}`,
        text: trimmedText,
        position,
        type,
        metadata
    };
}

/**
 * Estimate token count (rough approximation)
 * ~1 token per 4 characters for English
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Reassemble translated chunks into full document
 */
export function reassembleChunks(chunks: { text: string; type: string }[]): string {
    return chunks
        .map((chunk) => {
            // Add spacing based on chunk type
            if (chunk.type === 'heading') {
                return `\n\n${chunk.text}\n`;
            }
            return chunk.text;
        })
        .join('\n\n')
        .trim();
}

/**
 * Calculate chunks statistics
 */
export function getChunkStats(chunks: Chunk[]) {
    const totalTokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0);
    const avgTokensPerChunk = Math.round(totalTokens / chunks.length);

    return {
        totalChunks: chunks.length,
        totalTokens,
        avgTokensPerChunk,
        types: {
            heading: chunks.filter(c => c.type === 'heading').length,
            paragraph: chunks.filter(c => c.type === 'paragraph').length,
            list: chunks.filter(c => c.type === 'list').length,
            table: chunks.filter(c => c.type === 'table').length
        }
    };
}
