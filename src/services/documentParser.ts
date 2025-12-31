// Document Parser Service
// Extract text from PDF documents using PDF.js

import * as pdfjsLib from 'pdfjs-dist';
import type { DocumentStructure } from '../types';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
export async function extractStructuredContent(
    file: File,
    onProgress?: (current: number, total: number) => void
): Promise<DocumentStructure> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        // Extract text with formatting hints
        const pageText = textContent.items
            .map((item: any) => {
                // Detect headings (larger font size)
                const isHeading = item.height > 12;
                return isHeading ? `\n## ${item.str}\n` : item.str;
            })
            .join(' ');

        fullText += pageText + '\n\n';

        if (onProgress) {
            onProgress(i, pdf.numPages);
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
