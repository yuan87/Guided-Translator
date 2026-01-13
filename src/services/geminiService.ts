// Gemini Service
// Handle all Gemini API interactions for translation

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { GlossaryEntry, TermMatch, TranslatedChunk, Chunk, TokenUsage } from '../types';

// Key Management
interface ApiKeyConfig {
    key: string;
    isPaid: boolean;
}

let KEY_POOL: ApiKeyConfig[] = [{ key: import.meta.env.VITE_API_KEY || '', isPaid: false }];
let currentKeyIndex = 0;
let genAI = new GoogleGenerativeAI(KEY_POOL[0].key);

export function setApiKeys(keys: string[] | ApiKeyConfig[]) {
    if (keys.length > 0) {
        // Support both string[] (legacy) and ApiKeyConfig[] (new)
        if (typeof keys[0] === 'string') {
            KEY_POOL = (keys as string[]).map(k => ({ key: k, isPaid: false }));
        } else {
            KEY_POOL = keys as ApiKeyConfig[];
        }
        currentKeyIndex = 0;
        genAI = new GoogleGenerativeAI(KEY_POOL[0].key);
        const paidCount = KEY_POOL.filter(k => k.isPaid).length;
        console.log(`Updated API Key Pool: ${KEY_POOL.length} keys (${paidCount} paid, ${KEY_POOL.length - paidCount} free)`);
    }
}

export function hasPaidKeys(): boolean {
    return KEY_POOL.some(k => k.isPaid);
}

/**
 * Switch to a paid key if available
 * Returns true if successfully switched to a paid key
 */
export function skipToPaidKey(): boolean {
    const paidKeyIndex = KEY_POOL.findIndex(k => k.isPaid);
    if (paidKeyIndex !== -1 && paidKeyIndex !== currentKeyIndex) {
        currentKeyIndex = paidKeyIndex;
        genAI = new GoogleGenerativeAI(KEY_POOL[currentKeyIndex].key);
        console.log(`Skipped to Paid API Key #${currentKeyIndex + 1}`);
        return true;
    }
    return false;
}

function rotateKey(): boolean {
    if (KEY_POOL.length <= 1) return false;

    currentKeyIndex = (currentKeyIndex + 1) % KEY_POOL.length;
    genAI = new GoogleGenerativeAI(KEY_POOL[currentKeyIndex].key);
    const keyType = KEY_POOL[currentKeyIndex].isPaid ? 'Paid' : 'Free';
    console.log(`Switched to API Key #${currentKeyIndex + 1} of ${KEY_POOL.length} (${keyType})`);
    return true;
}

/**
 * Find relevant glossary terms that appear in the text
 */
function findRelevantTerms(text: string, glossary: GlossaryEntry[]): GlossaryEntry[] {
    const textLower = text.toLowerCase();
    return glossary.filter(entry => {
        const termLower = entry.english.toLowerCase();
        // Use word boundary check for better accuracy
        const regex = new RegExp(`\\b${termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(textLower);
    });
}

/**
 * Translate a chunk with glossary constraints
 */
export async function translateChunk(
    chunk: Chunk,
    glossary: GlossaryEntry[],
    onStatusUpdate?: (status: string) => void
): Promise<TranslatedChunk> {
    const relevantTerms = findRelevantTerms(chunk.text, glossary);
    const prompt = generatePrompt(chunk.text, relevantTerms);



    // Retry logic for rate limits (429)
    let retries = 0;
    const maxRetries = 3; // Reduced retries since we now wait 60s
    let keysTried = 0;

    while (retries <= maxRetries) {
        try {
            // Instantiate model (needed for key rotation to work)
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash-exp',
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 2048,
                },
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
            });

            const result = await model.generateContent(prompt);
            const response = result.response;
            const translation = cleanResponse(response.text());

            // Extract token usage
            const usageMetadata = response.usageMetadata;
            const tokenUsage: TokenUsage | undefined = usageMetadata ? {
                inputTokens: usageMetadata.promptTokenCount,
                outputTokens: usageMetadata.candidatesTokenCount,
                totalTokens: usageMetadata.totalTokenCount
            } : undefined;

            // Identify matched terms in the source text
            const matchedTerms = identifyTermsInText(chunk.text, glossary);

            return {
                ...chunk,
                translation,
                matchedTerms,
                newTerms: [],
                tokenUsage
            };
        } catch (error: any) {
            // Check for 429 or other transient errors
            if (error.message?.includes('429') || error.status === 429) {
                // Try rotating key first
                if (keysTried < KEY_POOL.length) {
                    const rotated = rotateKey();
                    if (rotated) {
                        keysTried++;
                        const keyType = KEY_POOL[currentKeyIndex].isPaid ? 'Paid' : 'Free';
                        if (onStatusUpdate) {
                            onStatusUpdate(`Rate limit hit. Switching to ${keyType} Key #${currentKeyIndex + 1}...`);
                        }
                        // Retry immediately with new key
                        continue;
                    }
                }

                // All keys exhausted - wait 60 seconds for free tier reset
                retries++;

                if (retries > maxRetries) {
                    throw new Error(`Rate limit exceeded. Please wait 1 minute and try again, or add a Paid API key for unlimited usage.`);
                }

                const hasPaid = KEY_POOL.some(k => k.isPaid);
                console.warn(`All ${KEY_POOL.length} keys rate limited for chunk ${chunk.id}. Waiting 60s...`);

                // Countdown loop with live updates
                for (let secondsLeft = 60; secondsLeft > 0; secondsLeft--) {
                    if (onStatusUpdate) {
                        const paidMsg = hasPaid
                            ? `⏱️ Rate limit hit. Waiting ${secondsLeft}s... (Click "Use Paid API" to skip)`
                            : `⏱️ Rate limit hit. Waiting ${secondsLeft}s... Add a Paid API key to skip wait.`;
                        onStatusUpdate(paidMsg);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                keysTried = 0; // Reset
            } else {
                console.error('Translation error:', error);
                throw new Error(`Failed to translate chunk ${chunk.id}: ${error}`);
            }
        }
    }
    throw new Error(`Unexpected error translation chunk ${chunk.id}`);
}

/**
 * Generate translation prompt with glossary
 */
function generatePrompt(text: string, relevantTerms: GlossaryEntry[]): string {
    const glossaryText = relevantTerms.length > 0
        ? relevantTerms.map(entry => `| ${entry.english} | ${entry.chinese} |`).join('\n')
        : "None applicable for this chunk.";

    return `You are a professional technical translator specializing in technical standards. 
Your task is to translate the following English text to Chinese.

CONTEXT:
This text is a segment from a technical standard. A glossary from a related standard is provided below to ensure consistency.

GLOSSARY OF TERMS TO BE USED:
| English Term | Mandated Chinese Translation |
| :--- | :--- |
${glossaryText}

TRANSLATION RULES:
1. MANDATORY: Use the exact Chinese translations provided in the GLOSSARY for all matching English terms.
2. FULL TRANSLATION: You MUST translate ALL text, including content within tables, lists, and charts. Do NOT leave any English text untranslated unless it is a proper noun.
3. PROPER NOUNS: Preserve proper names (person names like "von Mises"), standard codes (e.g., "EN 13001"), and specific technical identifiers in their original English form.
4. CLAUSE NUMBERS: If the text starts with a clause number (e.g., "5.2.1", "A.1"), PRESERVE IT EXACTLY at the start of the translation. Do not translate or modify clause numbers.
5. TABLES & LISTS: Translate the identifying labels (e.g., "Table 1", "Figure 2") and all cell content.
6. PRESERVE STRUCTURE EXACTLY:
   - Maintain the EXACT NUMBER of newline characters (\\n) as in the source.
   - If there are 2 newlines between paragraphs, use exactly 2 in translation.
   - If there are 3+ newlines (section breaks), preserve the exact count.
   - Keep all headings, list formats, numbering, and special characters exactly.
   - Preserve INDENTATION level for lists (use same number of spaces).
7. TONALITY: Use formal, objective, and precise technical language.
8. NO COMMENTARY: Provide ONLY the translation. Do not include markdown code blocks (\`\`\`) or prefixes like "Translation:".
8. TABLE & FORM PRESERVATION:
   - CRITICAL: If source contains tabular data, key-value pairs (e.g., "Name: John"), or form fields:
     * PRESERVE the layout using Markdown table syntax: | Label | Value |
     * OR maintain exact spacing and alignment if a table isn't appropriate.
   - Do NOT flatten tables into vertical lists.
   - Keep labels and values on the SAME LINE (e.g., "Username: yongseng87", NOT "Username:\nyongseng87").
   - Maintain the visual structure of forms.

TEXT TO TRANSLATE:
${text}

FINAL CHINESE TRANSLATION:`;
}

/**
 * Clean LLM response by removing markdown blocks and meta text
 */
function cleanResponse(text: string): string {
    let cleaned = text.trim();
    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/^```(json|markdown)?\n?/, '').replace(/```$/, '');
    // Remove common prefixes
    cleaned = cleaned.replace(/^(Here is the )?translation:?\s*/i, '');
    return cleaned.trim();
}

/**
 * Identify glossary terms in text using word boundaries
 */
export function identifyTermsInText(
    text: string,
    glossary: GlossaryEntry[]
): TermMatch[] {
    const matches: TermMatch[] = [];
    const textLower = text.toLowerCase();

    // Sort glossary by length descending to match longest terms first
    const sortedGlossary = [...glossary].sort((a, b) => b.english.length - a.english.length);

    for (const entry of sortedGlossary) {
        const termLower = entry.english.toLowerCase();
        const escapedTerm = termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedTerm} \\b`, 'gi');

        let match;
        const positions: number[] = [];

        while ((match = regex.exec(textLower)) !== null) {
            positions.push(match.index);
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
    onProgress?: (current: number, total: number) => void,
    onStatusUpdate?: (status: string) => void,
    onChunkComplete?: (chunk: TranslatedChunk) => void
): Promise<TranslatedChunk[]> {
    const translatedChunks: TranslatedChunk[] = [];

    // Parallel processing with limited concurrency (optional, for now serial with rate limit)
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
            // Updated to pass onStatusUpdate
            const translatedChunk = await translateChunk(chunk, glossary, onStatusUpdate);
            translatedChunks.push(translatedChunk);

            if (onProgress) {
                onProgress(i + 1, chunks.length);
            }

            if (onChunkComplete) {
                onChunkComplete(translatedChunk);
            }

            // Rate limiting for free tier Gemini API
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Increased delay for stability
            }
        } catch (error) {
            console.error(`Failed to translate chunk ${i}: `, error);
            translatedChunks.push({
                ...chunk,
                translation: `[Error: ${error instanceof Error ? error.message : 'Unknown error'}]`,
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
    const matchedTermSet = new Set<string>();

    for (const chunk of translatedChunks) {
        for (const match of chunk.matchedTerms) {
            matchedTermSet.add(match.english.toLowerCase());
        }
    }

    const matched = matchedTermSet.size;
    const total = glossary.length;
    const percentage = total > 0 ? Math.round((matched / total) * 100) : 0;

    return { matched, total, percentage };
}
