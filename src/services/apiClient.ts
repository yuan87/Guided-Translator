/**
 * API Client for Backend Communication
 * 
 * Handles all HTTP requests to the FastAPI backend.
 * Supports both development (localhost:8000) and Tauri production modes.
 */

// Backend base URL - changes based on environment
const getBackendUrl = (): string => {
    // Check if running in Tauri
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
        // Tauri: backend runs as sidecar on dynamic port
        // This will be replaced with actual sidecar port detection
        return 'http://localhost:8000';
    }

    // Development mode or web: use Vite proxy or direct URL
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
};

export const API_BASE = getBackendUrl();

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    return response.json();
}

// ============ API Keys ============

export interface ApiKeyStatus {
    gemini_configured: boolean;
    gemini_key_count: number;
    mineru_configured: boolean;
}

export async function setApiKeys(
    geminiKeys?: string[],
    mineruKey?: string
): Promise<ApiKeyStatus> {
    return apiFetch<ApiKeyStatus>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({
            gemini_keys: geminiKeys,
            mineru_key: mineruKey,
        }),
    });
}

export async function getKeyStatus(): Promise<ApiKeyStatus> {
    return apiFetch<ApiKeyStatus>('/api/keys/status');
}

export interface GeminiTestResult {
    status: 'ok' | 'error' | 'rate_limited' | 'no_key';
    message: string;
    rate_limited: boolean;
    response?: string;
}

export async function testGemini(): Promise<GeminiTestResult> {
    return apiFetch<GeminiTestResult>('/api/keys/test-gemini');
}

// ============ Document Parsing ============

export interface DocumentStructure {
    text: string;
    pages: number;
    word_count: number;
    language: 'en' | 'zh' | 'unknown';
}

export interface ParseResult {
    success: boolean;
    document?: DocumentStructure;
    error?: string;
}

export async function parsePdf(
    file: File,
    useMinerU: boolean = true
): Promise<ParseResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('use_mineru', String(useMinerU));

    const response = await fetch(`${API_BASE}/api/parse/pdf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Parse Error (${response.status}): ${errorText}`);
    }

    return response.json();
}

export async function parseMarkdown(file: File): Promise<ParseResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/parse/markdown`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Parse Error (${response.status}): ${errorText}`);
    }

    return response.json();
}

// ============ Translation ============

export interface GlossaryEntry {
    english: string;
    chinese: string;
}

export interface Chunk {
    id: string;
    content: string;
    index: number;
}

export interface TermMatch {
    term: string;
    translation: string;
    start_index: number;
    end_index: number;
}

export interface TranslatedChunk {
    id: string;
    original: string;
    translated: string;
    terms_used: TermMatch[];
    tokens_used?: number;
}

export interface TranslationProgress {
    event: 'progress' | 'chunk_complete' | 'error' | 'done';
    chunk_id?: string;
    current: number;
    total: number;
    translated_chunk?: TranslatedChunk;
    error_message?: string;
}

/**
 * Translate a single chunk
 */
export async function translateChunk(
    chunk: Chunk,
    glossary: GlossaryEntry[]
): Promise<TranslatedChunk> {
    return apiFetch<TranslatedChunk>('/api/translate/chunk', {
        method: 'POST',
        body: JSON.stringify({
            chunk,
            glossary,
        }),
    });
}

/**
 * Batch translate with SSE streaming
 * 
 * @param chunks - Array of chunks to translate
 * @param glossary - Glossary terms to enforce
 * @param onProgress - Callback for progress updates
 * @param onChunkComplete - Callback when a chunk finishes
 * @param onError - Callback for errors
 */
export async function translateBatchStreaming(
    chunks: Chunk[],
    glossary: GlossaryEntry[],
    onProgress?: (current: number, total: number) => void,
    onChunkComplete?: (chunk: TranslatedChunk) => void,
    onError?: (chunkId: string, error: string) => void
): Promise<TranslatedChunk[]> {
    const response = await fetch(`${API_BASE}/api/translate/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
            chunks,
            glossary,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Translation Error (${response.status}): ${errorText}`);
    }

    console.log('[SSE] Response received:', {
        status: response.status,
        contentType: response.headers.get('content-type'),
        ok: response.ok
    });

    const results: TranslatedChunk[] = [];
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        throw new Error('No response body for SSE stream');
    }

    let buffer = '';

    // Helper function to extract and parse all JSON events from buffer
    const extractEvents = (text: string): { events: TranslationProgress[], remaining: string } => {
        const events: TranslationProgress[] = [];
        let remaining = text;

        // Find all JSON objects in the text
        const regex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        let match;
        let lastIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(match[0]) as TranslationProgress;
                if (parsed.event) {
                    events.push(parsed);
                    lastIndex = regex.lastIndex;
                }
            } catch (e) {
                // Not valid JSON, skip
            }
        }

        // Keep any remaining text after the last parsed event
        remaining = text.substring(lastIndex);

        return { events, remaining };
    };

    // Process a list of events
    const processEvents = (events: TranslationProgress[]) => {
        for (const event of events) {
            console.log('[SSE] Event:', event.event, event.chunk_id);

            switch (event.event) {
                case 'progress':
                    onProgress?.(event.current, event.total);
                    break;

                case 'chunk_complete':
                    if (event.translated_chunk) {
                        console.log('[SSE] Chunk translated:', event.translated_chunk.id,
                            'Length:', event.translated_chunk.translated?.length);
                        results.push(event.translated_chunk);
                        onChunkComplete?.(event.translated_chunk);
                    }
                    onProgress?.(event.current, event.total);
                    break;

                case 'error':
                    console.error('[SSE] Translation error:', event.error_message);
                    onError?.(event.chunk_id || 'unknown', event.error_message || 'Unknown error');
                    break;

                case 'done':
                    console.log('[SSE] Translation complete, total chunks:', results.length);
                    break;
            }
        }
    };

    while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Try to extract and process events from buffer
        const { events, remaining } = extractEvents(buffer);
        if (events.length > 0) {
            processEvents(events);
        }
        buffer = remaining;
    }

    // Process any remaining events in the buffer
    if (buffer.trim()) {
        console.log('[SSE] Processing remaining buffer...');
        const { events } = extractEvents(buffer);
        if (events.length > 0) {
            processEvents(events);
        }
    }

    console.log('[SSE] Returning results:', results.length, 'chunks');
    return results;
}

/**
 * Synchronous batch translate (no streaming)
 */
export async function translateBatchSync(
    chunks: Chunk[],
    glossary: GlossaryEntry[]
): Promise<TranslatedChunk[]> {
    return apiFetch<TranslatedChunk[]>('/api/translate/batch/sync', {
        method: 'POST',
        body: JSON.stringify({
            chunks,
            glossary,
        }),
    });
}

// ============ Health Check ============

export async function healthCheck(): Promise<{ status: string }> {
    return apiFetch<{ status: string }>('/health');
}

// ============ PDF Export ============

export interface ExportPdfChunk {
    id: string;
    text: string;
    translation: string;
    type: 'heading' | 'paragraph' | 'list' | 'table';
    position: number;
}

export interface ExportPdfRequest {
    chunks: ExportPdfChunk[];
    title: string;
    include_original?: boolean;
}

/**
 * Export translation to text-based PDF via backend.
 * Returns a Blob that can be downloaded.
 */
export async function exportPdf(request: ExportPdfRequest): Promise<Blob> {
    const response = await fetch(`${API_BASE}/api/export/pdf`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PDF Export Error (${response.status}): ${errorText}`);
    }

    return response.blob();
}
