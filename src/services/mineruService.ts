// MinerU Cloud API Service
// Handles PDF-to-Markdown conversion via MinerU's cloud API

import type { DocumentStructure } from '../types';

// Use Vite proxy to bypass CORS - requests go to /api/mineru/* which proxies to mineru.net/api/v4/*
const MINERU_API_BASE = '/api/mineru';
const MINERU_API_KEY = import.meta.env.VITE_MINERU_API_KEY || '';

interface MineruTaskResponse {
    code: number;
    msg: string;
    data: {
        batch_id: string;
        task_id?: string;
    };
}

interface MineruStatusResponse {
    code: number;
    msg: string;
    data: {
        state: 'pending' | 'processing' | 'completed' | 'failed';
        progress?: number;
        result?: {
            markdown_url?: string;
            markdown_content?: string;
            full_result_url?: string;
        };
        error?: string;
    };
}

/**
 * Check if MinerU API key is configured
 */
export function isMineruConfigured(): boolean {
    return !!MINERU_API_KEY && MINERU_API_KEY.length > 0;
}

/**
 * Convert File to base64 string
 */
async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:application/pdf;base64,")
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Submit PDF to MinerU for extraction
 */
async function submitTask(file: File): Promise<string> {
    const fileBase64 = await fileToBase64(file);

    const response = await fetch(`${MINERU_API_BASE}/extract/task`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${MINERU_API_KEY}`
        },
        body: JSON.stringify({
            file: fileBase64,
            file_name: file.name,
            is_ocr: true,
            enable_formula: true,
            enable_table: true,
            output_format: 'markdown'
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MinerU API error: ${response.status} - ${errorText}`);
    }

    const result: MineruTaskResponse = await response.json();

    if (result.code !== 0) {
        throw new Error(`MinerU task submission failed: ${result.msg}`);
    }

    console.log('[MinerU] Task submitted:', result.data.batch_id);
    return result.data.batch_id;
}

/**
 * Poll task status until completion
 */
async function pollTaskStatus(
    batchId: string,
    onProgress?: (progress: number) => void,
    maxWaitMs: number = 300000 // 5 minutes max
): Promise<MineruStatusResponse['data']> {
    const startTime = Date.now();
    const pollIntervalMs = 3000; // Poll every 3 seconds

    while (Date.now() - startTime < maxWaitMs) {
        const response = await fetch(`${MINERU_API_BASE}/extract/task/${batchId}`, {
            headers: {
                'Authorization': `Bearer ${MINERU_API_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error(`MinerU status check failed: ${response.status}`);
        }

        const result: MineruStatusResponse = await response.json();

        if (result.code !== 0) {
            throw new Error(`MinerU status error: ${result.msg}`);
        }

        const { state, progress, error } = result.data;

        if (onProgress && progress !== undefined) {
            onProgress(progress);
        }

        console.log(`[MinerU] Task ${batchId} status: ${state} (${progress || 0}%)`);

        if (state === 'completed') {
            return result.data;
        }

        if (state === 'failed') {
            throw new Error(`MinerU extraction failed: ${error || 'Unknown error'}`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('MinerU task timed out');
}

/**
 * Download markdown content from result URL
 */
async function downloadMarkdown(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download markdown: ${response.status}`);
    }
    return response.text();
}

/**
 * Extract structured content from PDF using MinerU
 */
export async function extractWithMinerU(
    file: File,
    onProgress?: (current: number, total: number) => void
): Promise<DocumentStructure> {
    console.log('[MinerU] Starting extraction for:', file.name);

    // Submit task
    if (onProgress) onProgress(0, 100);
    const batchId = await submitTask(file);

    // Poll for completion
    const taskResult = await pollTaskStatus(batchId, (progress) => {
        if (onProgress) onProgress(progress, 100);
    });

    // Get markdown content
    let markdownContent = '';

    if (taskResult.result?.markdown_content) {
        markdownContent = taskResult.result.markdown_content;
    } else if (taskResult.result?.markdown_url) {
        markdownContent = await downloadMarkdown(taskResult.result.markdown_url);
    } else {
        throw new Error('MinerU result does not contain markdown content');
    }

    if (onProgress) onProgress(100, 100);
    console.log('[MinerU] Extraction complete, markdown length:', markdownContent.length);

    // Detect language from content
    const language = detectLanguage(markdownContent);

    // Count words
    const wordCount = markdownContent.split(/\s+/).filter(w => w.length > 0).length;

    // Estimate pages (rough approximation: ~500 words per page)
    const pages = Math.max(1, Math.ceil(wordCount / 500));

    return {
        text: markdownContent,
        pages,
        wordCount,
        language
    };
}

/**
 * Simple language detection
 */
function detectLanguage(text: string): 'en' | 'zh' | 'unknown' {
    // Count Chinese characters
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const totalChars = text.length;

    if (totalChars > 0 && chineseChars / totalChars > 0.1) {
        return 'zh';
    }
    return 'en';
}
