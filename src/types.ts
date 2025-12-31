// Core types for Guided Translator

export interface GlossaryEntry {
    english: string;
    chinese: string;
    source?: string; // Original document name
}

export interface TermIndex {
    [key: string]: GlossaryEntry;
}

export interface Chunk {
    id: string;
    text: string;
    position: number;
    type: 'heading' | 'paragraph' | 'list' | 'table';
    metadata?: {
        heading?: string;
        level?: number;
    };
}

export interface TranslatedChunk extends Chunk {
    translation: string;
    matchedTerms: TermMatch[];
    newTerms: NewTerm[];
}

export interface TermMatch {
    english: string;
    chinese: string;
    positions: number[]; // Character indices in chunk
    source: 'glossary' | 'new';
}

export interface NewTerm {
    english: string;
    chinese: string;
    frequency: number;
    chunks: string[]; // Chunk IDs where term appears
}

export interface DocumentStructure {
    text: string;
    pages: number;
    wordCount: number;
    language: 'en' | 'zh' | 'unknown';
}

export interface TranslationProgress {
    current: number;
    total: number;
    percentage: number;
    estimatedTimeRemaining: number;
    glossaryCoverage: {
        matched: number;
        total: number;
    };
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export type AppStatus = 'idle' | 'uploading' | 'processing' | 'translating' | 'complete' | 'error';

export interface AppState {
    glossary: GlossaryEntry[] | null;
    document: DocumentStructure | null;
    chunks: Chunk[];
    translatedChunks: TranslatedChunk[];
    progress: TranslationProgress;
    status: AppStatus;
    error: string | null;
}
