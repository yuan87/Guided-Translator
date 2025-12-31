import { useState } from 'react';
import { BookOpen, Languages } from 'lucide-react';
import GlossaryUpload from './components/GlossaryUpload';
import DocumentUpload from './components/DocumentUpload';
import TranslationPanel from './components/TranslationPanel';
import ProgressTracker from './components/ProgressTracker';
import ExportOptions from './components/ExportOptions';
import type { GlossaryEntry, DocumentStructure, Chunk, TranslatedChunk, AppStatus, TranslationProgress } from './types';
import { splitIntoChunks } from './services/chunkManager';
import { translateChunks, calculateCoverage } from './services/geminiService';

import './App.css';

function App() {
    const [glossary, setGlossary] = useState<GlossaryEntry[] | null>(null);
    const [document, setDocument] = useState<DocumentStructure | null>(null);
    const [chunks, setChunks] = useState<Chunk[]>([]);
    const [translatedChunks, setTranslatedChunks] = useState<TranslatedChunk[]>([]);
    const [status, setStatus] = useState<AppStatus>('idle');
    const [progress, setProgress] = useState<TranslationProgress>({
        current: 0,
        total: 0,
        percentage: 0,
        estimatedTimeRemaining: 0,
        glossaryCoverage: { matched: 0, total: 0 }
    });

    const handleGlossaryLoaded = (entries: GlossaryEntry[]) => {
        setGlossary(entries);
    };

    const handleDocumentLoaded = (doc: DocumentStructure) => {
        setDocument(doc);

        // Automatically chunk the document
        const documentChunks = splitIntoChunks(doc.text);
        setChunks(documentChunks);
    };

    const handleStartTranslation = async () => {
        if (!glossary || !document || chunks.length === 0) {
            alert('Please upload both a glossary and a document first');
            return;
        }

        setStatus('translating');
        setTranslatedChunks([]);

        const startTime = Date.now();

        try {
            const translated = await translateChunks(
                chunks,
                glossary,
                (current, total) => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const rate = current / elapsed;
                    const remaining = Math.max(0, Math.round((total - current) / rate));

                    setProgress({
                        current,
                        total,
                        percentage: Math.round((current / total) * 100),
                        estimatedTimeRemaining: remaining,
                        glossaryCoverage: {
                            matched: 0,
                            total: glossary.length
                        }
                    });
                }
            );

            setTranslatedChunks(translated);

            // Calculate final coverage
            const coverage = calculateCoverage(translated, glossary);
            setProgress(prev => ({
                ...prev,
                glossaryCoverage: coverage
            }));

            setStatus('complete');
        } catch (error) {
            console.error('Translation failed:', error);
            setStatus('error');
            alert('Translation failed. Please check your API key and try again.');
        }
    };

    const canTranslate = glossary && glossary.length > 0 && document && chunks.length > 0;
    const isTranslating = status === 'translating';
    const isComplete = status === 'complete';

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
            {/* Header */}
            <header className="bg-white shadow-md">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Languages className="w-8 h-8 text-blue-600" />
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">Guided Translator</h1>
                            <p className="text-sm text-gray-600">Glossary-aware technical translation</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Setup Section */}
                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    <GlossaryUpload
                        onGlossaryLoaded={handleGlossaryLoaded}
                        currentGlossary={glossary}
                    />
                    <DocumentUpload
                        onDocumentLoaded={handleDocumentLoaded}
                        currentDocument={document}
                    />
                </div>

                {/* Translation Control */}
                {canTranslate && !isComplete && (
                    <div className="mb-8">
                        <button
                            onClick={handleStartTranslation}
                            disabled={isTranslating}
                            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-4 px-6 rounded-lg shadow-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <BookOpen className="w-5 h-5" />
                            {isTranslating ? 'Translating...' : `Start Translation (${chunks.length} chunks)`}
                        </button>
                        {chunks.length > 0 && (
                            <p className="text-center text-sm text-gray-600 mt-2">
                                Estimated time: ~{Math.ceil(chunks.length / 60)} minute{chunks.length > 60 ? 's' : ''}
                            </p>
                        )}
                    </div>
                )}

                {/* Progress Tracker */}
                {(isTranslating || isComplete) && (
                    <div className="mb-8">
                        <ProgressTracker progress={progress} isTranslating={isTranslating} />
                    </div>
                )}

                {/* Translation Panel */}
                {translatedChunks.length > 0 && (
                    <div className="mb-8">
                        <TranslationPanel chunks={translatedChunks} />
                    </div>
                )}

                {/* Export Options */}
                {isComplete && translatedChunks.length > 0 && (
                    <ExportOptions
                        translatedChunks={translatedChunks}
                    />
                )}

                {/* Instructions */}
                {!canTranslate && (
                    <div className="bg-white rounded-lg shadow-md p-8 text-center">
                        <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <h2 className="text-xl font-semibold text-gray-700 mb-2">Getting Started</h2>
                        <ol className="text-left max-w-md mx-auto space-y-2 text-gray-600">
                            <li className="flex items-start gap-2">
                                <span className="font-semibold text-blue-600">1.</span>
                                <span>Upload a glossary CSV file (from Standard Linguist or similar)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-semibold text-blue-600">2.</span>
                                <span>Upload an English PDF document to translate</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="font-semibold text-blue-600">3.</span>
                                <span>Click "Start Translation" to begin</span>
                            </li>
                        </ol>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="bg-white border-t mt-16">
                <div className="max-w-7xl mx-auto px-6 py-4 text-center text-sm text-gray-500">
                    Powered by Gemini 2.0 • Built with React + TypeScript
                </div>
            </footer>
        </div>
    );
}

export default App;
