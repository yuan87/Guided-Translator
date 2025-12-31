// Gemini Service
// Handle all Gemini API interactions for translation

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { GlossaryEntry, TermMatch, TranslatedChunk, Chunk } from '../types';

const API_KEY = import.meta.env.VITE_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

/**
 * Translate a chunk with glossary constraints
 */
export async function translateChunk(
    chunk: Chunk,
    glossary: GlossaryEntry[]
): Promise<TranslatedChunk> {
    const prompt = generatePrompt(chunk.text, glossary);

    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
        },
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
    });

    try {
        const result = await model.generateContent(prompt);
        const translation = result.response.text().trim();

        // Identify matched terms
        const matchedTerms = identifyTermsInText(chunk.text, glossary);

        // Identify new terms (placeholder - would need more sophisticated NLP)
        const newTerms: any[] = [];

        return {
            ...chunk,
            translation,
            matchedTerms,
            newTerms
        };
    } catch (error) {
        console.error('Translation error:', error);
        throw new Error(`Failed to translate chunk ${chunk.id}: ${error}`);
    }
}

/**
 * Generate translation prompt with glossary
 */
function generatePrompt(text: string, glossary: GlossaryEntry[]): string {
    // Limit glossary to most relevant terms (first 100 to avoid context overflow)
    const glossaryText = glossary
        .slice(0, 100)
        .map(entry => `"${entry.english}" → "${entry.chinese}"`)
        .join('\n');

    return `You are translating a technical standard from English to Chinese.

GLOSSARY (from a related standard in this domain):
${glossaryText}

TRANSLATION RULES:
1. When a term from the GLOSSARY appears in the text, use the EXACT Chinese translation provided
2. For terms NOT in the glossary, translate naturally using technical Chinese conventions
3. Preserve all formatting (headings, lists, numbering, line breaks)
4. Maintain technical accuracy and consistency
5. Keep the same document structure

IMPORTANT: This document is different from the glossary source but shares the same technical domain.

TEXT TO TRANSLATE:
${text}

Provide ONLY the Chinese translation. Do not add explanations, notes, or commentary.`;
}

/**
 * Identify glossary terms in text
 */
export function identifyTermsInText(
    text: string,
    glossary: GlossaryEntry[]
): TermMatch[] {
    const matches: TermMatch[] = [];
    const textLower = text.toLowerCase();

    for (const entry of glossary) {
        const termLower = entry.english.toLowerCase();

        // Find all occurrences
        const positions: number[] = [];
        let index = textLower.indexOf(termLower);

        while (index !== -1) {
            positions.push(index);
            index = textLower.indexOf(termLower, index + 1);
        }

        if (positions.length > 0) {
            matches.push({
                english: entry.english,
                chinese: entry.chinese,
                positions,
                source: 'glossary'
            });
        }
    }

    return matches;
}

/**
 * Batch translate multiple chunks with progress tracking
 */
export async function translateChunks(
    chunks: Chunk[],
    glossary: GlossaryEntry[],
    onProgress?: (current: number, total: number) => void
): Promise<TranslatedChunk[]> {
    const translatedChunks: TranslatedChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
            const translatedChunk = await translateChunk(chunk, glossary);
            translatedChunks.push(translatedChunk);

            if (onProgress) {
                onProgress(i + 1, chunks.length);
            }

            // Rate limiting: wait 1 second between requests
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`Failed to translate chunk ${i}:`, error);
            // Continue with next chunk even if one fails
            translatedChunks.push({
                ...chunk,
                translation: '[Translation failed]',
                matchedTerms: [],
                newTerms: []
            });
        }
    }

    return translatedChunks;
}

/**
 * Calculate glossary coverage statistics
 */
export function calculateCoverage(
    translatedChunks: TranslatedChunk[],
    glossary: GlossaryEntry[]
): { matched: number; total: number; percentage: number } {
    const matchedTerms = new Set<string>();

    for (const chunk of translatedChunks) {
        for (const match of chunk.matchedTerms) {
            matchedTerms.add(match.english.toLowerCase());
        }
    }

    const matched = matchedTerms.size;
    const total = glossary.length;
    const percentage = Math.round((matched / total) * 100);

    return { matched, total, percentage };
}
