import { extractStructuredContent } from './src/services/documentParser';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfjsLib from 'pdfjs-dist';
import { pathToFileURL } from 'url';

// Set up PDF.js worker for Node text extraction
// We must override the browser-specific setting from documentParser.ts
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).toString();

// Polyfill File for Node.js environment
if (typeof File === 'undefined') {
    global.File = class File extends Blob {
        name: string;
        lastModified: number;

        constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag) {
            super(fileBits, options);
            this.name = fileName;
            this.lastModified = options?.lastModified || Date.now();
        }
    } as any;
}

async function runTest() {
    const filePath = path.resolve('fixtures/EN 13001-3-1 - 2025.pdf');
    console.log(`Reading file from: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        console.error('Fixture file not found!');
        return;
    }

    const buffer = fs.readFileSync(filePath);
    // Create File object from buffer
    const file = new File([buffer], 'EN 13001-3-1 - 2025.pdf', { type: 'application/pdf' });

    console.log('--- Starting PDF Extraction Test ---');
    console.log('Using Legacy Parsing (No API Keys provided)');

    try {
        const result = await extractStructuredContent(file, [], (current, total) => {
            process.stdout.write(`\rProcessing page ${current}/${total}`);
        });

        console.log('\n\nExtraction Successful!');
        console.log('Language:', result.language);
        console.log('Word Count:', result.wordCount);
        console.log('Pages:', result.pages);

        console.log('\n--- Text Preview (First 500 chars) ---');
        console.log(result.text.substring(0, 500) + '...');
        console.log('--------------------');

        if (result.pages > 0 && result.text.length > 0) {
            console.log('✅ TEST PASSED');
        } else {
            console.log('❌ TEST FAILED: Empty content');
        }
    } catch (error) {
        console.error('\n❌ TEST FAILED with error:', error);
    }
}

runTest();
