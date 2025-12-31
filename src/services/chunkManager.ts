// Chunk Manager Service
// Split large documents into translation-friendly chunks

import type { Chunk } from '../types';

/**
 * Split text into chunks for translation
 * Target: 500-1000 tokens per chunk
 */
export function splitIntoChunks(text: string, maxTokens: number = 800): Chunk[] {
    const chunks: Chunk[] = [];

    // Split into paragraphs first
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    let currentChunk = '';
    let chunkPosition = 0;

    for (const paragraph of paragraphs) {
        const estimatedTokens = estimateTokens(currentChunk + paragraph);

        // If adding this paragraph exceeds limit, save current chunk
        if (currentChunk && estimatedTokens > maxTokens) {
            chunks.push(createChunk(currentChunk, chunkPosition++));
            currentChunk = '';
        }

        // If single paragraph is too large, split it further
        if (estimateTokens(paragraph) > maxTokens) {
            // Split on sentence boundaries
            const sentences = splitIntoSentences(paragraph);

            for (const sentence of sentences) {
                if (estimateTokens(currentChunk + sentence) > maxTokens && currentChunk) {
                    chunks.push(createChunk(currentChunk, chunkPosition++));
                    currentChunk = '';
                }
                currentChunk += sentence + ' ';
            }
        } else {
            currentChunk += paragraph + '\n\n';
        }
    }

    // Add remaining chunk
    if (currentChunk.trim()) {
        chunks.push(createChunk(currentChunk, chunkPosition));
    }

    return chunks;
}

/**
 * Create a chunk object
 */
function createChunk(text: string, position: number): Chunk {
    const trimmedText = text.trim();

    // Detect chunk type
    const isHeading = /^#{1,6}\s/.test(trimmedText) || /^[A-Z][^.!?]*$/.test(trimmedText.split('\n')[0]);
    const isList = /^[\-\*\d]+[\.\)]\s/.test(trimmedText);
    const isTable = trimmedText.includes('|') && trimmedText.split('\n').filter(l => l.includes('|')).length > 2;

    let type: Chunk['type'] = 'paragraph';
    let metadata: Chunk['metadata'] = {};

    if (isHeading) {
        type = 'heading';
        const headingMatch = trimmedText.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            metadata.level = headingMatch[1].length;
            metadata.heading = headingMatch[2];
        } else {
            metadata.heading = trimmedText.split('\n')[0];
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
 * Split paragraph into sentences
 */
function splitIntoSentences(text: string): string[] {
    // Split on period, exclamation, question mark followed by space/newline
    return text
        .split(/([.!?]+[\s\n]+)/)
        .reduce((acc: string[], curr, i, arr) => {
            if (i % 2 === 0) {
                acc.push(curr + (arr[i + 1] || ''));
            }
            return acc;
        }, [])
        .filter(s => s.trim());
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
