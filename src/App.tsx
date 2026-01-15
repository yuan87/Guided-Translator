// Main App Component with Persistence
import { useState, useEffect, useMemo } from 'react';
import GlossaryUpload from './components/GlossaryUpload';
import DocumentUpload from './components/DocumentUpload';
import TranslationPanel from './components/TranslationPanel';
import ProgressTracker from './components/ProgressTracker';
import ExportOptions from './components/ExportOptions';
import EditingInterface from './components/EditingInterface';
import RefinementSuggestions from './components/RefinementSuggestions';
import UserGlossaryPanel from './components/UserGlossaryPanel';
import SavedProjectsPanel from './components/SavedProjectsPanel'; // Import SavedProjectsPanel
import ResumeModal from './components/ResumeModal';
import DeveloperPanel from './components/DeveloperPanel'; // Import Developer Panel
import { extractStandardTitle } from './services/documentParser';
import { splitIntoChunks } from './services/chunkManager';
import { translateChunks, calculateCoverage, setApiKeys, hasPaidKeys, skipToPaidKey } from './services/geminiService';
import { analyzeEdit, extractTerminologyChanges, RefinementPattern } from './services/editAnalysisService';
import { addUserPreference } from './services/userGlossaryService'; // Corrected imports
import { storageService } from './services/storageService';
import ApiKeyManager from './components/ApiKeyManager'; // Import Key Manager
import type { GlossaryEntry, TranslatedChunk, TranslationProgress, AppStatus, Chunk, Project, TokenUsage } from './types';
import TokenStats from './components/TokenStats'; // Import TokenStats component
import { Book, FileText, Settings, AlertTriangle } from 'lucide-react'; // Added AlertTriangle

export default function App() {
    // Application State
    const [status, setStatus] = useState<AppStatus>('idle');
    const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
    const [chunks, setChunks] = useState<Chunk[]>([]);
    const [translatedChunks, setTranslatedChunks] = useState<TranslatedChunk[]>([]);
    const [progress, setProgress] = useState<TranslationProgress>({ current: 0, total: 0, percentage: 0, estimatedTimeRemaining: 0, glossaryCoverage: { matched: 0, total: 0 } });
    const [isTranslating, setIsTranslating] = useState(false);

    // Persistence State
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [resumableProject, setResumableProject] = useState<Project | null>(null);
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [pendingFile, setPendingFile] = useState<{ file: File, text: string } | null>(null);
    const [warningMessage, setWarningMessage] = useState<string | null>(null);
    const [showProjectsPanel, setShowProjectsPanel] = useState(false); // Persistence Panel State
    const [loadedDocument, setLoadedDocument] = useState<import('./types').DocumentStructure | null>(null);
    const [showUsePaidButton, setShowUsePaidButton] = useState(false); // Show "Use Paid API" button

    // Token Usage Tracking
    const [sessionTokenUsage, setSessionTokenUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    // Edit & Refine Mode State
    const [editMode, setEditMode] = useState(false);
    const [currentEditPage, setCurrentEditPage] = useState(0);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [lastAnalysis, setLastAnalysis] = useState<{
        pattern: RefinementPattern;
        affectedCount: number;
    } | null>(null);

    // Initialize Storage and API Keys
    const [availableApiKeys, setAvailableApiKeys] = useState<{ key: string, isPaid: boolean }[]>([]);

    useEffect(() => {
        storageService.init().catch(console.error);

        // Load keys from localStorage or env
        const storedKeys = localStorage.getItem('gemini_api_keys');
        if (storedKeys) {
            try {
                const parsedKeys = JSON.parse(storedKeys);
                if (Array.isArray(parsedKeys) && parsedKeys.length > 0) {
                    // Handle both legacy string[] and new ApiKeyConfig[]
                    const normalizedKeys = typeof parsedKeys[0] === 'string'
                        ? parsedKeys.map((k: string) => ({ key: k, isPaid: false }))
                        : parsedKeys;
                    setApiKeys(normalizedKeys);
                    setAvailableApiKeys(normalizedKeys);
                }
            } catch (e) {
                console.error("Failed to parse stored API keys", e);
            }
        }
    }, []);

    const handleApiKeysUpdated = (keys: { key: string, isPaid: boolean }[]) => {
        setApiKeys(keys);
        setAvailableApiKeys(keys);
        localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
    };

    // Load Project Handler
    const loadProject = async (project: Project) => {
        console.log('[DEBUG] loadProject called for:', project.standardTitle, 'status:', project.status);
        try {
            const storedChunks = await storageService.getProjectChunks(project.id);
            console.log('[DEBUG] Retrieved', storedChunks.length, 'chunks from storage');

            const reconstructedTranslatedChunks: TranslatedChunk[] = storedChunks.map(c => ({
                id: c.chunkId,
                position: c.position,
                text: c.originalText,
                type: c.originalType,
                translation: c.currentTranslation, // Load the *edit* version
                matchedTerms: c.matchedTerms,
                newTerms: []
            }));

            setCurrentProject(project);
            setTranslatedChunks(reconstructedTranslatedChunks);

            // Reconstruct source chunks - ensure 'text' property is properly set
            const sourceChunks = reconstructedTranslatedChunks.map(c => ({
                id: c.id,
                text: c.text,
                position: c.position,
                type: c.type,
                metadata: c.metadata
            }));
            console.log('[DEBUG] Setting chunks:', sourceChunks.length)
            setChunks(sourceChunks);

            // Restore state based on project status
            if (project.status === 'completed' || project.status === 'editing') {
                console.log('[DEBUG] Project is completed/editing, setting status to complete');
                setStatus('complete');
                setProgress(prev => ({
                    ...prev,
                    glossaryCoverage: calculateCoverage(reconstructedTranslatedChunks, glossary)
                }));
            } else if (project.status === 'translating') {
                console.log('[DEBUG] Project is translating, setting status to idle for resume');
                setStatus('idle'); // Allow resuming
            } else {
                // For parsing or other incomplete states
                console.log('[DEBUG] Project is in state:', project.status, '- setting status to idle');
                setStatus('idle');
            }
        } catch (err) {
            console.error("Failed to load project", err);
        }
    };

    const handleResume = async () => {
        if (resumableProject) {
            await loadProject(resumableProject);
            setShowResumeModal(false);
            setPendingFile(null);
            setResumableProject(null);
        }
    };

    const handleStartOver = async () => {
        if (pendingFile) {
            // Create new Project
            const project: Project = {
                id: crypto.randomUUID(),
                standardTitle: extractStandardTitle(pendingFile.text, pendingFile.file.name),
                lastModified: Date.now(),
                status: 'parsing',
                totalChunks: 0,
                translatedChunks: 0
            };

            await storageService.saveProject(project);
            setCurrentProject(project);

            // Process chunks
            const parsedChunks = splitIntoChunks(pendingFile.text);
            setChunks(parsedChunks);
            setStatus('idle');

            setShowResumeModal(false);
            setPendingFile(null);
            setResumableProject(null);
        }
    };

    const handleGlossaryLoaded = async (entries: GlossaryEntry[]) => {
        setGlossary(entries);
    };

    const handleDocumentLoaded = async (doc: import('./types').DocumentStructure) => {
        console.log('[DEBUG] handleDocumentLoaded called', { pages: doc.pages, wordCount: doc.wordCount, textLength: doc.text.length });
        const text = doc.text;
        setLoadedDocument(doc); // <-- Track the loaded document for UI display

        const standardTitle = extractStandardTitle(text, "Document");
        console.log('[DEBUG] Extracted standard title:', standardTitle);

        // Check for existing project
        const existingProject = await storageService.getProjectByTitle(standardTitle);
        console.log('[DEBUG] Existing project check:', existingProject ? 'FOUND' : 'NOT FOUND');

        if (existingProject) {
            console.log('[DEBUG] Showing resume modal for existing project');
            setResumableProject(existingProject);
            // Mock file object
            setPendingFile({ file: new File([text], "document.pdf"), text });
            setShowResumeModal(true);
        } else {
            // New Project
            console.log('[DEBUG] Creating new project...');
            const project: Project = {
                id: crypto.randomUUID(),
                standardTitle,
                lastModified: Date.now(),
                status: 'parsing',
                totalChunks: 0,
                translatedChunks: 0
            };
            await storageService.saveProject(project);
            setCurrentProject(project);
            console.log('[DEBUG] Project saved, now splitting into chunks...');

            const parsedChunks = splitIntoChunks(text);
            console.log('[DEBUG] splitIntoChunks returned', parsedChunks.length, 'chunks');
            setChunks(parsedChunks);
            console.log('[DEBUG] setChunks called, setting status to idle');
            setStatus('idle');
        }
    };

    const handleStartTranslation = async () => {
        if (!currentProject) return;

        setIsTranslating(true);
        setStatus('translating');
        setWarningMessage(null);

        // Update project status
        const updatedProject = { ...currentProject, status: 'translating', totalChunks: chunks.length } as Project;
        await storageService.saveProject(updatedProject);
        setCurrentProject(updatedProject);

        const startTime = Date.now();

        // Reset session token usage if starting fresh, or keep if resuming in same session?
        // Let's reset for "new run" feeling
        setSessionTokenUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

        // Determine start index based on existing translated chunks
        const startIndex = translatedChunks.length;
        const chunksToTranslate = chunks.slice(startIndex);

        if (chunksToTranslate.length === 0) {
            setIsTranslating(false);
            setStatus('complete');
            return;
        }

        const newResults = await translateChunks(chunksToTranslate, glossary, async (current, total) => {
            const globalCurrent = startIndex + current;
            const globalTotal = chunks.length;

            const elapsed = (Date.now() - startTime) / 1000;
            const rate = current / elapsed; // Rate based on *this session's* work
            const remaining = Math.max(0, Math.round((total - current) / rate));

            setProgress({
                current: globalCurrent,
                total: globalTotal,
                percentage: Math.round((globalCurrent / globalTotal) * 100),
                estimatedTimeRemaining: remaining,
                glossaryCoverage: {
                    matched: 0,
                    total: glossary.length
                }
            });

            // Auto-save progress
            if (currentProject) {
                await storageService.updateProjectProgress(currentProject.id, globalCurrent);
            }
        }, (statusMsg: string) => {
            setWarningMessage(statusMsg);
            // Show "Use Paid API" button when countdown is active (indicated by ⏱️)
            if (statusMsg.includes('⏱️') && hasPaidKeys()) {
                setShowUsePaidButton(true);
            } else {
                setShowUsePaidButton(false);
            }
        }, async (chunkResult: TranslatedChunk) => {
            // Token aggregation
            if (chunkResult.tokenUsage) {
                setSessionTokenUsage(prev => ({
                    inputTokens: prev.inputTokens + (chunkResult.tokenUsage?.inputTokens || 0),
                    outputTokens: prev.outputTokens + (chunkResult.tokenUsage?.outputTokens || 0),
                    totalTokens: prev.totalTokens + (chunkResult.tokenUsage?.totalTokens || 0)
                }));
            }

            // INCREMENTAL UPDATE - Update UI immediately as each chunk completes
            setTranslatedChunks(prev => [...prev, chunkResult]);

            // INCREMENTAL SAVE - Persist chunk immediately after translation
            if (currentProject) {
                const chunkData: import('./types').ChunkData = {
                    projectId: currentProject.id,
                    chunkId: chunkResult.id,
                    position: chunkResult.position,
                    originalText: chunkResult.text,
                    originalType: chunkResult.type,
                    initialTranslation: chunkResult.translation,
                    currentTranslation: chunkResult.translation,
                    matchedTerms: chunkResult.matchedTerms
                };
                await storageService.saveChunks([chunkData]);
                console.log(`[DB] Saved chunk ${chunkResult.id} to IndexedDB`);
            }
        });

        // Note: translatedChunks state is already updated incrementally via onChunkComplete
        // Just calculate coverage based on current state
        const finalCoverage = calculateCoverage(translatedChunks, glossary);

        setProgress(prev => ({
            ...prev,
            percentage: 100,
            glossaryCoverage: finalCoverage
        }));

        setIsTranslating(false);
        setStatus('complete');
        setWarningMessage(null);

        // Final Save of Translation
        const completedProject = {
            ...updatedProject,
            status: 'completed',
            translatedChunks: finalResults.length,
            lastModified: Date.now()
        } as Project;

        await storageService.saveProject(completedProject);

        // Ensure new chunks are saved
        const newChunkDataList: import('./types').ChunkData[] = newResults.map(chunk => ({
            projectId: completedProject.id,
            chunkId: chunk.id,
            position: chunk.position,
            originalText: chunk.text,
            originalType: chunk.type,
            initialTranslation: chunk.translation,
            currentTranslation: chunk.translation,
            matchedTerms: chunk.matchedTerms
        }));

        await storageService.saveChunks(newChunkDataList);
    };


    // Memoize the chunk slicing to prevent re-renders and state loss
    const editingChunks = useMemo(() => {
        const start = currentEditPage * 4;
        return translatedChunks.slice(start, start + 4);
    }, [translatedChunks, currentEditPage]);

    const handleEditSubmit = async (editedBatch: TranslatedChunk[]) => {
        setIsAnalyzing(true);
        try {
            // 1. Construct EditDiff
            const originalChunk = editingChunks[0];
            const editedChunk = editedBatch[0];

            const diff = {
                chunkId: originalChunk.id,
                originalTranslation: originalChunk.translation,
                editedTranslation: editedChunk.translation,
                englishContext: originalChunk.text
            };

            // 2. Analyze
            // Only analyze if there is a difference to avoid API calls
            let patterns: RefinementPattern[] = [];
            if (originalChunk.translation !== editedChunk.translation) {
                patterns = await analyzeEdit(diff);
            }

            // 3. Apply Patterns and Merge Manual Edits
            let updatedAllChunks = [...translatedChunks];

            let totalApplied = 0;
            const appliedPatterns: RefinementPattern[] = [];

            if (patterns && patterns.length > 0) {
                for (const pattern of patterns) {
                    if (pattern.type === 'terminology' && pattern.oldTerm && pattern.newTerm) {
                        let appliedCount = 0;
                        updatedAllChunks = updatedAllChunks.map(chunk => {
                            // Don't override the chunks being manually edited in this batch
                            if (chunk.translation.includes(pattern.oldTerm!)) {
                                const newText = chunk.translation.split(pattern.oldTerm!).join(pattern.newTerm!);
                                if (newText !== chunk.translation) {
                                    appliedCount++;
                                    return { ...chunk, translation: newText };
                                }
                            }
                            return chunk;
                        });

                        if (appliedCount > 0) {
                            totalApplied += appliedCount;
                            appliedPatterns.push(pattern);
                        }
                    }
                }
            }

            // Apply manual edits
            editedBatch.forEach(edited => {
                const index = updatedAllChunks.findIndex(c => c.id === edited.id);
                if (index !== -1) updatedAllChunks[index] = edited;
            });

            setTranslatedChunks(updatedAllChunks);

            if (appliedPatterns.length > 0) {
                setLastAnalysis({ pattern: appliedPatterns[0], affectedCount: totalApplied });
            }

            // 4. Update User Glossary
            if (appliedPatterns.length > 0) {
                const changes = extractTerminologyChanges(appliedPatterns);
                changes.forEach(change => {
                    addUserPreference(
                        change.english,
                        change.oldChinese,
                        change.newChinese,
                        originalChunk.position,
                        originalChunk.text.substring(0, 100)
                    );
                });
            }

            // 5. Persist Updates
            if (currentProject) {
                const chunkDataList = updatedAllChunks.map(c => ({
                    projectId: currentProject.id,
                    chunkId: c.id,
                    position: c.position,
                    originalText: c.text,
                    originalType: c.type,
                    initialTranslation: c.translation,
                    currentTranslation: c.translation,
                    matchedTerms: c.matchedTerms
                }));
                await storageService.saveChunks(chunkDataList);
                await storageService.saveProject({
                    ...currentProject,
                    lastModified: Date.now()
                });
            }

        } catch (error) {
            console.error("Analysis failed", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-900">
            {/* Header */}
            <header className="bg-white border-b sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600 p-2 rounded-lg">
                            <Book className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Guided Translator</h1>
                            <p className="text-sm text-slate-500 font-medium">Terminology-Aware Technical Translation</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {currentProject && (
                            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full border border-blue-100">
                                <FileText className="w-3 h-3 text-blue-600" />
                                <span className="text-xs font-semibold text-blue-700 truncate max-w-[150px]">
                                    {currentProject.standardTitle}
                                </span>
                            </div>
                        )}
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${status === 'idle' && chunks.length > 0 ? 'bg-emerald-100 text-emerald-700' :
                            status === 'processing' || status === 'translating' ? 'bg-amber-100 text-amber-700' :
                                status === 'complete' ? 'bg-blue-100 text-blue-700' :
                                    'bg-slate-100 text-slate-600'
                            }`}>
                            {status === 'idle' && chunks.length === 0 && 'Ready to Upload'}
                            {status === 'idle' && chunks.length > 0 && 'Document Ready'}
                            {status === 'processing' && 'Analyzing Document...'}
                            {status === 'translating' && 'Translating...'}
                            {status === 'complete' && 'AI Translation Complete'}
                        </span>

                        {/* Projects Toggle */}
                        <button
                            onClick={() => setShowProjectsPanel(true)}
                            className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors"
                            title="Saved Projects"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span className="hidden sm:inline font-medium">Projects</span>
                        </button>

                        {/* API Key Manager */}
                        <ApiKeyManager
                            onKeysUpdated={handleApiKeysUpdated}
                            initialKeys={JSON.parse(localStorage.getItem('gemini_api_keys') || '[]')}
                        />
                    </div>
                </div>
            </header>

            {/* Resume Modal */}
            {
                showResumeModal && resumableProject && (
                    <ResumeModal
                        project={resumableProject}
                        onResume={handleResume}
                        onStartOver={handleStartOver}
                    />
                )
            }

            <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
                {/* Upload Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <GlossaryUpload
                        onGlossaryLoaded={handleGlossaryLoaded}
                        currentGlossary={glossary}
                    />
                    <DocumentUpload
                        onDocumentLoaded={handleDocumentLoaded}
                        currentDocument={loadedDocument}
                        apiKeys={availableApiKeys}
                    />
                </div>

                {/* Warning Banner */}
                {warningMessage && (
                    <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 rounded shadow-md">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                                <div>
                                    <p className="font-bold">Rate Limit Warning</p>
                                    <p className="text-sm">{warningMessage}</p>
                                </div>
                            </div>
                            {showUsePaidButton && hasPaidKeys() && (
                                <button
                                    onClick={() => {
                                        if (skipToPaidKey()) {
                                            setWarningMessage('Switched to Paid API key. Retrying...');
                                            setShowUsePaidButton(false);
                                        }
                                    }}
                                    className="px-4 py-2 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 whitespace-nowrap"
                                >
                                    <span>💰</span>
                                    Use Paid API
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Progress Tracking */}
                {isTranslating && (
                    <div className="space-y-4">
                        <ProgressTracker progress={progress} isTranslating={isTranslating} />
                        <div className="flex justify-end">
                            <TokenStats usage={{
                                input: sessionTokenUsage.inputTokens,
                                output: sessionTokenUsage.outputTokens,
                                total: sessionTokenUsage.totalTokens
                            }} />
                        </div>
                    </div>
                )}

                {/* Start Translation Button */}
                {chunks.length > 0 && !isTranslating && status !== 'complete' && (
                    <div className="flex justify-center pt-8">
                        <button
                            onClick={handleStartTranslation}
                            className="group relative px-8 py-4 bg-blue-600 text-white text-lg font-bold rounded-xl shadow-xl hover:bg-blue-700 transform hover:-translate-y-1 transition-all"
                        >
                            {translatedChunks.length > 0
                                ? `Resume Translation (from ${translatedChunks.length + 1}/${chunks.length})`
                                : 'Start Translation'}
                            <span className="absolute -right-2 -top-2 w-4 h-4 bg-emerald-400 rounded-full animate-ping" />
                        </button>
                    </div>
                )}

                {/* Chunk Preview - Shows parsed content before translation */}
                {chunks.length > 0 && status === 'idle' && !isTranslating && (
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                                <FileText className="w-5 h-5 text-blue-600" />
                                Parsed Document ({chunks.length} chunks)
                            </h3>
                            <span className="text-sm text-slate-500">
                                Ready for translation
                            </span>
                        </div>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {chunks.slice(0, 5).map((chunk, idx) => (
                                <div key={chunk.id} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                                            Chunk {idx + 1}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                            {chunk.text.split(/\s+/).length} words
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-700 line-clamp-3">
                                        {chunk.text.substring(0, 300)}
                                        {chunk.text.length > 300 && '...'}
                                    </p>
                                </div>
                            ))}
                            {chunks.length > 5 && (
                                <div className="text-center text-sm text-slate-500 py-2">
                                    ... and {chunks.length - 5} more chunks
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Content Area - Translation View */}
                {(status === 'complete' || status === 'translating') && !editMode && (
                    <>
                        <div className="flex justify-end">
                            {status === 'complete' && (
                                <button
                                    onClick={() => setEditMode(true)}
                                    className="px-6 py-3 bg-violet-600 text-white rounded-xl hover:bg-violet-700 shadow-lg shadow-violet-200 transition-all font-semibold flex items-center gap-2"
                                >
                                    <Settings className="w-4 h-4" />
                                    Enter Edit & Refine Mode
                                </button>
                            )}
                        </div>
                        <TranslationPanel
                            chunks={translatedChunks}
                            isTranslating={isTranslating}
                        />
                    </>
                )}

                {/* Edit & Refine Interface */}
                {status === 'complete' && editMode && (
                    <div className="animate-in slide-in-from-bottom-10 fade-in duration-500 space-y-8">
                        {/* Suggestions Panel */}
                        {lastAnalysis && (
                            <RefinementSuggestions
                                patterns={[lastAnalysis.pattern]}
                                appliedContexts={new Map()}
                                onClose={() => setLastAnalysis(null)}
                            />
                        )}

                        <EditingInterface
                            chunks={editingChunks}
                            allChunks={translatedChunks}
                            currentPage={currentEditPage}
                            totalPages={Math.ceil(translatedChunks.length / 4)}
                            onSubmit={handleEditSubmit}
                            onNavigate={setCurrentEditPage}
                            isAnalyzing={isAnalyzing}
                        />

                        {/* User Glossary Management */}
                        <UserGlossaryPanel />
                    </div>
                )}

                {/* Footer Controls */}
                {status === 'complete' && (
                    <ExportOptions
                        translatedChunks={translatedChunks}
                    />
                )}
            </main>
            {/* Saved Projects Panel */}
            <SavedProjectsPanel
                isOpen={showProjectsPanel}
                onClose={() => setShowProjectsPanel(false)}
                onLoadProject={loadProject}
                currentProjectId={currentProject?.id}
            />

            {/* Resume Modal */}
            {showResumeModal && resumableProject && (
                <ResumeModal
                    project={resumableProject}
                    onResume={() => {
                        setShowResumeModal(false);
                        loadProject(resumableProject);
                    }}
                    onStartOver={() => {
                        setShowResumeModal(false);
                        handleStartOver();
                    }}
                />
            )}

            {/* Developer Panel - Shows API status */}
            <DeveloperPanel />
        </div>
    );
}
