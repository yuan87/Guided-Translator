// Document Parser Service
// Extract text from PDF documents using PDF.js

import * as pdfjsLib from 'pdfjs-dist';
import type { DocumentStructure } from '../types';

// Set up PDF.js worker using unpkg for better reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Page extraction result for streaming
 */
export interface PageExtractionResult {
    pageNum: number;
    totalPages: number;
    content: string;
    complexity: 'simple' | 'complex' | 'table';
    confidence?: number;
}

/**
 * Layout analysis thresholds
 */
interface LayoutThresholds {
    sameLine: number;
    newLine: number;
    paragraphBreak: number;
}

/**
 * Analyze document page to determine dynamic thresholds
 */
function analyzeDocumentLayout(textContent: any): LayoutThresholds {
    const verticalGaps: number[] = [];
    let lastY = -1;

    const items = textContent.items as any[];

    // Collect all vertical gaps
    for (const item of items) {
        // Skip empty strings
        if (!item.str.trim()) continue;

        const y = item.transform[5];
        if (lastY !== -1) {
            const gap = Math.abs(y - lastY);
            // Filter out 0 gaps (same visual line parts) and huge gaps
            if (gap > 0.1 && gap < 500) {
                verticalGaps.push(gap);
            }
        }
        lastY = y;
    }

    // Default fallbacks if page is empty or too simple
    if (verticalGaps.length < 5) {
        return { sameLine: 3, newLine: 15, paragraphBreak: 30 };
    }

    // Sort to find clustering
    verticalGaps.sort((a, b) => a - b);

    // Simple verification of distribution
    // Usually clusters around line-height (e.g. 12-14) and paragraph gap (e.g. 20-30)

    // We take percentiles to estimate
    const p20 = verticalGaps[Math.floor(verticalGaps.length * 0.2)];
    const p50 = verticalGaps[Math.floor(verticalGaps.length * 0.5)];
    const p80 = verticalGaps[Math.floor(verticalGaps.length * 0.8)];

    return {
        // Gap < sameLine = join words
        // Gap > sameLine && < paragraphBreak = new line in same paragraph (or list item)
        // Gap > paragraphBreak = new paragraph

        // p20 is likely line noise or same-line parts. p50 is likely the standard line height.
        sameLine: Math.max(p20 * 0.8, 2),
        newLine: Math.max(p50 * 1.5, 10),
        paragraphBreak: Math.max(p80 * 1.2, 25)
    };
}

/**
 * Calculate the dominant left margin to detect indentation
 */
function calculateLeftMargin(textContent: any): number {
    const items = textContent.items as any[];
    const xPositions: number[] = [];

    for (const item of items) {
        if (!item.str.trim()) continue;
        xPositions.push(item.transform[4]);
    }

    if (xPositions.length === 0) return 0;

    // Find the most frequent X position (allowing small variance)
    // Round to nearest 5 to group slightly misaligned items
    const counts = new Map<number, number>();
    let maxCount = 0;
    let dominantX = xPositions[0];

    for (const x of xPositions) {
        const bin = Math.round(x / 5) * 5;
        const count = (counts.get(bin) || 0) + 1;
        counts.set(bin, count);

        if (count > maxCount) {
            maxCount = count;
            dominantX = bin; // Use the bin representative
        } else if (count === maxCount && bin < dominantX) {
            // Prefer leftmost if counts are tied (standard margin)
            dominantX = bin;
        }
    }

    return dominantX;
}

/**
 * Extract standard title/code from text
 * Looks for patterns like "EN 13001-3-1", "ISO 9001", etc.
 */
export function extractStandardTitle(text: string, filename: string): string {
    // Look for common standard patterns in the first 1000 chars
    const headerText = text.substring(0, 1000);

    // Pattern for EN/ISO standards (e.g., EN 13001-3-1, ISO 9001:2015)
    // Matches: Word(2-4 chars) + space + Number + optional separators and numbers
    // e.g. "EN 12345", "ISO 9001", "IEC 60000-1-2"
    const standardRegex = /\b([A-Z]{2,4})\s+(\d{3,6}(?:[-:]\d+)*)/;
    const match = headerText.match(standardRegex);

    if (match) {
        return `${match[1]} ${match[2]}`;
    }

    // Fallback: use filename without extension
    return filename.replace(/\.[^/.]+$/, "");
}

/**
 * Extract full text from PDF file
 */
export async function extractText(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');

        fullText += pageText + '\n\n';
    }

    return fullText;
}

/**
 * Extract structured content from PDF
 */

/**
 * Extract structured content from Markdown file
 */
export async function extractMarkdown(file: File): Promise<DocumentStructure> {
    const text = await file.text();
    const language = detectLanguage(text);
    // Simple word count for markdown (split by whitespace)
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return {
        text: text.trim(),
        pages: Math.ceil(wordCount / 500) || 1, // Estimate pages based on word count (approx 500 words/page)
        wordCount,
        language
    };
}

/**
 * Extract text from a single PDF page using legacy rule-based parser
 * Used for simple pages in hybrid routing for speed and cost savings
 */
async function extractTextLegacy(page: any): Promise<string> {
    const textContent = await page.getTextContent();
    const thresholds = analyzeDocumentLayout(textContent);
    const leftMargin = calculateLeftMargin(textContent);

    let lastY = -1;
    let lastX = 0;
    let lastWidth = 0;
    let currentLine = '';
    let currentIndent = 0;
    const lines: string[] = [];
    const rawItems = textContent.items as any[];

    for (const item of rawItems) {
        const text = item.str;
        if (!text.trim()) continue;

        const y = item.transform[5];
        const x = item.transform[4];
        const height = item.height || 12;
        const isHeading = height > 12;
        const relativeX = Math.max(0, x - leftMargin);
        const indentLevel = Math.floor(relativeX / 20);

        if (lastY === -1) {
            currentLine = text;
            currentIndent = indentLevel;
            lastY = y;
            lastX = x;
            lastWidth = height > 0 ? (item.width || text.length * 6) : 0;
        } else {
            const verticalGap = Math.abs(y - lastY);

            if (verticalGap < thresholds.sameLine) {
                const textWidth = item.width || (text.length * 6);
                const currentX = item.transform[4];
                const gapX = currentX - (lastX + lastWidth);

                if (currentLine && !currentLine.endsWith('-') && !text.startsWith(' ')) {
                    if (gapX > 30) {
                        currentLine += ' | ' + text;
                    } else {
                        currentLine += ' ' + text;
                    }
                } else if (currentLine.endsWith('-')) {
                    if (text[0] && text[0] === text[0].toLowerCase()) {
                        currentLine = currentLine.slice(0, -1) + text;
                    } else {
                        currentLine += text;
                    }
                } else {
                    currentLine += text;
                }

                lastX = currentX;
                lastWidth = textWidth;
            } else {
                if (currentLine.trim()) {
                    const indentString = currentIndent > 0 ? '  '.repeat(currentIndent) : '';
                    const formattedLine = isHeading ? `## ${currentLine}` : `${indentString}${currentLine}`;
                    lines.push(formattedLine);
                }
                if (verticalGap > thresholds.paragraphBreak) {
                    lines.push('');
                }
                currentLine = text;
                currentIndent = indentLevel;
                lastY = y;
                lastX = x;
                lastWidth = item.width || (text.length * 6);
            }
        }
    }

    if (currentLine.trim()) {
        const indentString = currentIndent > 0 ? '  '.repeat(currentIndent) : '';
        lines.push(indentString + currentLine);
    }

    return lines.join('\n');
}

/**
 * Extract structured content from File (PDF or Markdown)
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Analyze page complexity to determine optimal rendering and extraction method
 * Returns: 'simple' (text only), 'complex' (mixed), or 'table' (table-heavy)
 */
async function analyzePageComplexity(page: any): Promise<'simple' | 'complex' | 'table'> {
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];

    if (items.length === 0) return 'simple';

    // Detect tables by analyzing spatial gaps (multiple distinct X positions)
    const xPositions = items.map((i: any) => Math.round(i.transform[4] / 10) * 10);
    const uniqueColumns = new Set(xPositions).size;

    // Heuristics for complexity:
    // - More than 6 distinct column positions = likely table-heavy
    // - More than 4 columns = complex (mixed content)
    // - More than 300 text items = dense content
    const hasTable = uniqueColumns > 6;
    const isComplex = uniqueColumns > 4;
    const isDense = items.length > 300;

    if (hasTable) return 'table';
    if (isComplex || isDense) return 'complex';
    return 'simple';
}

/**
 * Convert PDF page to base64 image with adaptive quality
 * Higher resolution for complex pages (tables, formulas)
 */
async function convertPageToImage(page: any): Promise<string> {
    // Analyze page complexity
    const complexity = await analyzePageComplexity(page);

    // Dynamic scaling: complex pages get higher resolution
    const scale = complexity === 'complex' ? 2.0 : 1.5;
    const quality = complexity === 'complex' ? 0.9 : 0.8;

    console.log(`Page rendering: ${complexity} → scale ${scale}, quality ${quality}`);

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    // Convert to base64 (JPEG with adaptive quality)
    const base64 = canvas.toDataURL('image/jpeg', quality);
    return base64.split(',')[1]; // Remove prefix
}

/**
 * Domain-specific prompt for technical standard documents
 * Uses context engineering: concise core instructions + structured format
 */
const TECHNICAL_STANDARD_PROMPT = `# PDF Page → Markdown Transcription

## Instructions
1. Transcribe this technical document page into Markdown
2. Preserve exact structure: headers (##/###), tables, lists, formulas
3. Do NOT summarize - output verbatim content only

## Format Rules
- Headers: ## Main | ### Sub | #### Detail
- Tables: | Col1 | Col2 | with alignment row |---|---|
- Formulas: \`inline\` or \`\`\`block\`\`\`
- Multi-column: process left-to-right, top-to-bottom

## Output
Return ONLY the Markdown. No commentary.`;

/**
 * Specialized prompt for table-heavy pages
 * Uses context engineering: focused instructions for table accuracy
 */
const TABLE_EXTRACTION_PROMPT = `# Table-Focused Markdown Extraction

## Task
Extract ALL tables and surrounding context from this page.

## Table Rules
1. Use | Col1 | Col2 | syntax with |---|---| alignment row
2. Preserve ALL columns - never merge or skip
3. Multi-line cells: join with space, keep on one row
4. Empty cells: use "-" not blank
5. Uncertain values: use "?" with best guess

## Context
Include headers/text immediately before/after tables.

## Output
Markdown only. No commentary.`;

/**
 * Validation prompt for checking extraction quality
 * Uses context engineering: concise structured validation request
 */
const VALIDATION_PROMPT = `# Extraction Validation

## Task
Compare the Markdown extraction to the original image.

## Check For
1. Missing headers or sections
2. Malformed/incomplete tables
3. Lost list items or formulas

## Response Format (JSON only)
{"isValid": true/false, "confidence": 0-100, "issues": ["issue1", "issue2"]}`;

/**
 * Validation result interface
 */
interface ValidationResult {
    isValid: boolean;
    confidence: number;
    issues: string[];
}

/**
 * Validate extracted content by comparing to original image
 * Uses a second LLM pass to catch extraction errors
 */
async function validateExtractedContent(
    markdown: string,
    imageBase64: string,
    apiKey: string
): Promise<ValidationResult> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const validationRequest = `${VALIDATION_PROMPT}

## Extracted Markdown
\`\`\`
${markdown.substring(0, 2000)}
\`\`\`

Now validate against the original image:`;

        const imagePart = {
            inlineData: { data: imageBase64, mimeType: "image/jpeg" }
        };

        const result = await model.generateContent([validationRequest, imagePart]);
        const responseText = result.response.text();

        // Parse JSON response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                isValid: parsed.isValid ?? true,
                confidence: parsed.confidence ?? 80,
                issues: parsed.issues ?? []
            };
        }

        // Default if parsing fails
        return { isValid: true, confidence: 70, issues: [] };
    } catch (error) {
        console.warn("Validation failed, assuming valid:", error);
        return { isValid: true, confidence: 50, issues: ["Validation skipped due to error"] };
    }
}

/**
 * Run an AI task with key rotation and failover
 * Tries each key in the pool until success or all fail
 */
async function runWithFailover<T>(
    keys: string[],
    task: (model: any, apiKey: string) => Promise<T>
): Promise<T> {
    const errors: any[] = [];

    for (const key of keys) {
        try {
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            return await task(model, key);
        } catch (error) {
            console.warn(`API call failed with key: ${key.substring(0, 8)}... - Trying next key`, error);
            errors.push(error);
        }
    }

    throw new Error(`All API keys failed: ${errors.map(e => e.message).join('; ')}`);
}

/**
 * Streaming extraction generator for progressive UI updates
 * Yields page-by-page results as they complete
 */
export async function* extractStructuredContentStreaming(
    file: File,
    apiKeys: string | string[]
): AsyncGenerator<PageExtractionResult> {
    const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];

    // Only works for PDFs with at least one API key
    if (!file.name.endsWith('.pdf') || keys.length === 0 || !keys[0]) {
        return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const complexity = await analyzePageComplexity(page);

        let content: string;
        let confidence = 80;

        if (complexity === 'simple') {
            // Simple → Legacy (no API call needed)
            content = await extractTextLegacy(page);
            confidence = 90; // High confidence for simple text
        } else {
            // Complex/Table → AI Vision
            const imageBase64 = await convertPageToImage(page);
            const prompt = complexity === 'table' ? TABLE_EXTRACTION_PROMPT : TECHNICAL_STANDARD_PROMPT;

            const imagePart = {
                inlineData: { data: imageBase64, mimeType: "image/jpeg" }
            };

            try {
                content = await runWithFailover(keys, async (model, key) => {
                    const result = await model.generateContent([prompt, imagePart]);
                    const text = result.response.text();

                    // Optional: Run validation for complex pages
                    if (complexity === 'table') {
                        const validation = await validateExtractedContent(text, imageBase64, key);
                        confidence = validation.confidence;
                    }
                    return text;
                });
            } catch (failoverError) {
                console.warn(`All AI keys failed for page ${i}, falling back to legacy:`, failoverError);
                content = await extractTextLegacy(page);
                confidence = 40; // Low confidence for fallback content on a complex page
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        yield {
            pageNum: i,
            totalPages: pdf.numPages,
            content,
            complexity,
            confidence
        };
    }
}

/**
 * Extract text from image using Gemini API (single page)
 * @deprecated Prefer extractTextWithGeminiBatch for better performance
 * Kept as fallback for error recovery scenarios
 */
// @ts-expect-error - Kept as fallback function, not currently used
async function extractTextWithGemini(imageBase64: string, apiKey: string): Promise<string> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // Use flash model for speed and cost effectiveness
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const imagePart = {
            inlineData: {
                data: imageBase64,
                mimeType: "image/jpeg"
            }
        };

        const result = await model.generateContent([TECHNICAL_STANDARD_PROMPT, imagePart]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini Vision Extraction Failed:", error);
        throw new Error("AI Visual Extraction failed. Please check your API key or try again.");
    }
}

/**
 * Extract text from multiple images using Gemini API (batched)
 * Processes 2-4 pages in a single API call to reduce latency and cost
 * @deprecated Currently unused due to hybrid routing, kept for future batch mode option
 */
// @ts-expect-error - Kept for future batch processing mode
async function extractTextWithGeminiBatch(imageBase64Array: string[], apiKey: string): Promise<string[]> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Construct batch prompt
        const batchPrompt = `${TECHNICAL_STANDARD_PROMPT}

IMPORTANT: You are processing ${imageBase64Array.length} consecutive pages from the same document.
- Process each page separately
- After each page's content, insert exactly this separator: ---PAGE_BREAK---
- Maintain page order (page 1, then page 2, etc.)

Format:
[Page 1 content]
---PAGE_BREAK---
[Page 2 content]
---PAGE_BREAK---
[Page 3 content]`;

        // Create image parts array
        const imageParts = imageBase64Array.map(data => ({
            inlineData: {
                data: data,
                mimeType: "image/jpeg"
            }
        }));

        // Send batch request
        const result = await model.generateContent([batchPrompt, ...imageParts]);
        const response = await result.response;
        const fullText = response.text();

        // Split by separator and clean up
        const pages = fullText.split('---PAGE_BREAK---')
            .map(page => page.trim())
            .filter(page => page.length > 0);

        // Ensure we got the expected number of pages
        if (pages.length !== imageBase64Array.length) {
            console.warn(`Expected ${imageBase64Array.length} pages, got ${pages.length}. Using fallback.`);
            // Fallback: return the full text as a single page if parsing failed
            return [fullText];
        }

        return pages;
    } catch (error) {
        console.error("Gemini Vision Batch Extraction Failed:", error);
        throw new Error("AI Visual Batch Extraction failed. Please check your API key or try again.");
    }
}

/**
 * Extract structured content from File (PDF or Markdown)
 * @param file - The file to extract content from
 * @param apiKeys - Gemini API keys for AI vision parsing (legacy fallback)
 * @param progressCallback - Progress callback for UI updates
 * @param useMinerU - If true, use MinerU cloud API via backend (default: false)
 * @param useBackend - If true, use backend API for PDF parsing (default: true)
 */
export async function extractStructuredContent(
    file: File,
    apiKeys?: string | string[],
    progressCallback?: (current: number, total: number) => void,
    useMinerU: boolean = false,
    useBackend: boolean = true
): Promise<DocumentStructure> {
    // Handle Markdown files separately (can be done client-side)
    if (file.name.endsWith('.md') || file.type === 'text/markdown') {
        if (progressCallback) progressCallback(1, 1);
        return extractMarkdown(file);
    }

    // Use backend API for PDF extraction if enabled
    if (useBackend && (file.type === 'application/pdf' || file.name.endsWith('.pdf'))) {
        const { parsePdf } = await import('./apiClient');

        console.log('[Parser] Using backend API for PDF extraction...');
        if (progressCallback) progressCallback(0, 100);

        try {
            const result = await parsePdf(file, useMinerU);

            if (!result.success || !result.document) {
                console.warn('[Parser] Backend parsing failed, falling back to legacy:', result.error);
                // Fall through to legacy parsing below
            } else {
                if (progressCallback) progressCallback(100, 100);

                return {
                    text: result.document.text,
                    pages: result.document.pages,
                    wordCount: result.document.word_count,
                    language: result.document.language
                };
            }
        } catch (error) {
            console.warn('[Parser] Backend API error, falling back to legacy:', error);
            // Fall through to legacy parsing
        }
    }

    // Legacy: Use MinerU directly (old path, kept for compatibility)
    if (useMinerU && (file.type === 'application/pdf' || file.name.endsWith('.pdf'))) {
        const { extractWithMinerU, isMineruConfiguredSync } = await import('./mineruService');

        if (!isMineruConfiguredSync()) {
            console.warn('[MinerU] API key not configured, falling back to legacy parser');
        } else {
            console.log('[MinerU] Using MinerU cloud API for PDF extraction...');
            return extractWithMinerU(file, progressCallback);
        }
    }

    // Handle PDF files with legacy/hybrid parsing
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    const keys = Array.isArray(apiKeys) ? apiKeys : (apiKeys ? [apiKeys] : []);

    // If API key is present, use Hybrid Visual AI Parsing
    if (keys.length > 0 && keys[0]) {
        console.log(`Using Hybrid Parsing with Key Rotation (${keys.length} keys available)...`);

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);

            // Analyze page complexity to choose extraction method
            const complexity = await analyzePageComplexity(page);

            let pageText: string;

            if (complexity === 'table' || complexity === 'complex') {
                const isTable = complexity === 'table';
                console.log(`Page ${i}: ${complexity} → AI Vision (${isTable ? 'Table' : 'Standard'} Mode)`);
                const imageBase64 = await convertPageToImage(page);

                const imagePart = {
                    inlineData: { data: imageBase64, mimeType: "image/jpeg" }
                };

                try {
                    pageText = await runWithFailover(keys, async (model) => {
                        const prompt = isTable ? TABLE_EXTRACTION_PROMPT : TECHNICAL_STANDARD_PROMPT;
                        const result = await model.generateContent([prompt, imagePart]);
                        return result.response.text();
                    });
                } catch (failoverError) {
                    console.warn(`All AI keys failed for page ${i}, falling back to legacy:`, failoverError);
                    pageText = await extractTextLegacy(page);
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                // Simple page → Legacy for speed & cost savings
                console.log(`Page ${i}: Simple → Legacy Parser`);
                pageText = await extractTextLegacy(page);
            }

            fullText += pageText + '\n\n';

            if (progressCallback) {
                progressCallback(i, pdf.numPages);
            }
        }
    } else {
        // Fallback to Rule-Based Extraction (Legacy)
        console.log("Using Legacy PDF.js Parsing (No API Key provided to parser)...");
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // Calculate adaptive thresholds for this page
            const thresholds = analyzeDocumentLayout(textContent);
            const leftMargin = calculateLeftMargin(textContent);

            // Smart text extraction with position-based line merging
            let lastY = -1;
            let lastX = 0;
            let lastWidth = 0;
            let currentLine = '';
            let currentIndent = 0;
            const lines: string[] = [];
            const rawItems = textContent.items as any[];

            for (let j = 0; j < rawItems.length; j++) {
                const item = rawItems[j];
                const text = item.str;

                if (!text.trim()) continue;

                const y = item.transform[5];
                const x = item.transform[4];
                const height = item.height || 12;
                const isHeading = height > 12;
                const relativeX = Math.max(0, x - leftMargin);
                const indentLevel = Math.floor(relativeX / 20);

                if (lastY === -1) {
                    currentLine = text;
                    currentIndent = indentLevel;
                    lastY = y;
                    lastX = x;
                    lastWidth = height > 0 ? (item.width || text.length * 6) : 0;
                } else {
                    const verticalGap = Math.abs(y - lastY);

                    if (verticalGap < thresholds.sameLine) {
                        const textWidth = item.width || (text.length * 6);
                        const currentX = item.transform[4];
                        const gapX = currentX - (lastX + lastWidth);

                        if (currentLine && !currentLine.endsWith('-') && !text.startsWith(' ')) {
                            if (gapX > 30) {
                                currentLine += ' | ' + text;
                            } else {
                                currentLine += ' ' + text;
                            }
                        } else if (currentLine.endsWith('-')) {
                            if (text[0] && text[0] === text[0].toLowerCase()) {
                                currentLine = currentLine.slice(0, -1) + text;
                            } else {
                                currentLine += text;
                            }
                        } else {
                            currentLine += text;
                        }

                        lastX = currentX;
                        lastWidth = textWidth;
                    } else {
                        if (currentLine.trim()) {
                            const indentString = currentIndent > 0 ? '  '.repeat(currentIndent) : '';
                            const formattedLine = isHeading ? `## ${currentLine}` : `${indentString}${currentLine}`;
                            lines.push(formattedLine);
                        }
                        if (verticalGap > thresholds.paragraphBreak) {
                            lines.push('');
                        }
                        currentLine = text;
                        currentIndent = indentLevel;
                        lastY = y;
                        lastX = x;
                        lastWidth = item.width || (text.length * 6);
                    }
                }
            }

            if (currentLine.trim()) {
                const indentString = currentIndent > 0 ? '  '.repeat(currentIndent) : '';
                lines.push(indentString + currentLine);
            }

            fullText += lines.join('\n') + '\n\n';

            if (progressCallback) {
                progressCallback(i, pdf.numPages);
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    const language = detectLanguage(fullText);
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    return {
        text: fullText.trim(),
        pages: pdf.numPages,
        wordCount,
        language
    };
}

/**
 * Detect document language
 */
export function detectLanguage(text: string): 'en' | 'zh' | 'unknown' {
    const sample = text.slice(0, 1000);

    // Count Chinese characters
    const chineseChars = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;

    // Count English words
    const englishWords = (sample.match(/[a-zA-Z]+/g) || []).length;

    if (chineseChars > englishWords) {
        return 'zh';
    } else if (englishWords > chineseChars * 2) {
        return 'en';
    }

    return 'unknown';
}

/**
 * Estimate reading time in minutes
 */
export function estimateReadingTime(wordCount: number): number {
    const wordsPerMinute = 200;
    return Math.ceil(wordCount / wordsPerMinute);
}
