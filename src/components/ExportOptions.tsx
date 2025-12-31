// Export Options Component
import { Download, FileText } from 'lucide-react';
import type { TranslatedChunk } from '../types';
import { reassembleChunks } from '../services/chunkManager';

interface ExportOptionsProps {
    translatedChunks: TranslatedChunk[];
}

export default function ExportOptions({ translatedChunks }: ExportOptionsProps) {
    if (translatedChunks.length === 0) {
        return null;
    }

    const handleExportText = (format: 'translation' | 'bilingual') => {
        let content = '';

        if (format === 'translation') {
            content = reassembleChunks(
                translatedChunks.map(chunk => ({ text: chunk.translation, type: chunk.type }))
            );
        } else {
            content = translatedChunks
                .map((chunk) => {
                    return `[Original]\n${chunk.text}\n\n[Translation]\n${chunk.translation}\n\n${'='.repeat(80)}\n`;
                })
                .join('\n');
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `translation_${format}_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportNewTerms = () => {
        // Collect all new terms
        const newTermsMap = new Map<string, { chinese: string; frequency: number; chunks: string[] }>();

        for (const chunk of translatedChunks) {
            for (const term of chunk.newTerms || []) {
                const existing = newTermsMap.get(term.english);
                if (existing) {
                    existing.frequency += term.frequency;
                    existing.chunks.push(...term.chunks);
                } else {
                    newTermsMap.set(term.english, {
                        chinese: term.chinese,
                        frequency: term.frequency,
                        chunks: [...term.chunks]
                    });
                }
            }
        }

        // Convert to CSV
        const csvLines = ['English,Chinese,Frequency,Chunks'];
        for (const [english, data] of newTermsMap.entries()) {
            csvLines.push(`"${english}","${data.chinese}",${data.frequency},"${data.chunks.join(';')}"`);
        }

        const csv = csvLines.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `new_terms_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Download className="w-5 h-5" />
                Export Options
            </h2>

            <div className="space-y-3">
                {/* Translation Only */}
                <button
                    onClick={() => handleExportText('translation')}
                    className="w-full flex items-center justify-between p-4 border border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors group"
                >
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-gray-600 group-hover:text-blue-600" />
                        <div className="text-left">
                            <p className="font-medium text-gray-800">Translation Only</p>
                            <p className="text-sm text-gray-500">Chinese translation as plain text</p>
                        </div>
                    </div>
                    <Download className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />
                </button>

                {/* Bilingual */}
                <button
                    onClick={() => handleExportText('bilingual')}
                    className="w-full flex items-center justify-between p-4 border border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors group"
                >
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-gray-600 group-hover:text-blue-600" />
                        <div className="text-left">
                            <p className="font-medium text-gray-800">Bilingual Document</p>
                            <p className="text-sm text-gray-500">Original + Translation side-by-side</p>
                        </div>
                    </div>
                    <Download className="w-5 h-5 text-gray-400 group-hover:text-blue-600" />
                </button>

                {/* New Terms */}
                <button
                    onClick={handleExportNewTerms}
                    className="w-full flex items-center justify-between p-4 border border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors group"
                >
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-gray-600 group-hover:text-green-600" />
                        <div className="text-left">
                            <p className="font-medium text-gray-800">New Terms (CSV)</p>
                            <p className="text-sm text-gray-500">Terms not in original glossary</p>
                        </div>
                    </div>
                    <Download className="w-5 h-5 text-gray-400 group-hover:text-green-600" />
                </button>
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600">
                    💡 Tip: Export new terms to expand your glossary for future translations
                </p>
            </div>
        </div>
    );
}
