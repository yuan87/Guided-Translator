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

    const results: TranslatedChunk[] = [];
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        throw new Error('No response body for SSE stream');
    }

    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.startsWith('data:')) {
                const jsonStr = line.slice(5).trim();
                if (!jsonStr) continue;

                try {
                    const event: TranslationProgress = JSON.parse(jsonStr);

                    switch (event.event) {
                        case 'progress':
                            onProgress?.(event.current, event.total);
                            break;

                        case 'chunk_complete':
                            if (event.translated_chunk) {
                                results.push(event.translated_chunk);
                                onChunkComplete?.(event.translated_chunk);
                            }
                            onProgress?.(event.current, event.total);
                            break;

                        case 'error':
                            onError?.(event.chunk_id || 'unknown', event.error_message || 'Unknown error');
                            break;

                        case 'done':
                            // Translation complete
                            break;
                    }
                } catch (e) {
                    console.warn('Failed to parse SSE event:', line, e);
                }
            }
        }
    }

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
