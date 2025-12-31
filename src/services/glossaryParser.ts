// Glossary Parser Service
// Parses CSV glossaries exported from Standard Linguist

import type { GlossaryEntry, TermIndex, ValidationResult } from '../types';

/**
 * Parse CSV file and extract glossary entries
 */
export async function parseCSV(file: File): Promise<GlossaryEntry[]> {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
        throw new Error('CSV file is empty');
    }

    // Detect header row
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('english') || header.includes('term') || header.includes('source');

    const dataLines = hasHeader ? lines.slice(1) : lines;
    const entries: GlossaryEntry[] = [];

    for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (!line) continue;

        // Parse CSV line (handle quoted values)
        const fields = parseCSVLine(line);

        if (fields.length < 2) {
            console.warn(`Line ${i + 1}: Invalid format, skipping`);
            continue;
        }

        entries.push({
            english: fields[0].trim(),
            chinese: fields[1].trim(),
            source: fields[2]?.trim()
        });
    }

    return entries;
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current);
    return result.map(field => field.replace(/^"|"$/g, '').trim());
}

/**
 * Validate glossary entries
 */
export function validateGlossary(entries: GlossaryEntry[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (entries.length === 0) {
        errors.push('No glossary entries found');
    }

    // Check for empty entries
    const emptyEntries = entries.filter(e => !e.english || !e.chinese);
    if (emptyEntries.length > 0) {
        warnings.push(`${emptyEntries.length} entries have missing English or Chinese translations`);
    }

    // Check for duplicates
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const entry of entries) {
        const key = entry.english.toLowerCase();
        if (seen.has(key)) {
            duplicates.push(entry.english);
        }
        seen.add(key);
    }

    if (duplicates.length > 0) {
        warnings.push(`${duplicates.length} duplicate entries found: ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? '...' : ''}`);
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Build fast lookup index for term matching
 */
export function buildTermIndex(entries: GlossaryEntry[]): TermIndex {
    const index: TermIndex = {};

    for (const entry of entries) {
        // Store both exact and lowercase versions
        index[entry.english] = entry;
        index[entry.english.toLowerCase()] = entry;
    }

    return index;
}

/**
 * Find matching glossary term (case-insensitive)
 */
export function findTerm(term: string, index: TermIndex): GlossaryEntry | undefined {
    return index[term] || index[term.toLowerCase()];
}

/**
 * Extract glossary statistics
 */
export function getGlossaryStats(entries: GlossaryEntry[]) {
    return {
        totalTerms: entries.length,
        uniqueTerms: new Set(entries.map(e => e.english.toLowerCase())).size,
        averageTermLength: Math.round(
            entries.reduce((sum, e) => sum + e.english.length, 0) / entries.length
        )
    };
}
