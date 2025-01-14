import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

export async function dynamicImport(modulePath: string) {
    // Resolve full path
    const fullPath = path.resolve(modulePath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Module not found: ${fullPath}`);
    }

    // Handle TypeScript files
    if (fullPath.endsWith('.ts')) {
        // Compile TS to JS
        const program = ts.createProgram([fullPath], {
            target: ts.ScriptTarget.ES2015,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        });

        program.emit();
        const jsPath = fullPath.replace('.ts', '.js');

        // Import compiled JS
        const module = await import(jsPath);

        // Clean up temporary JS file
        if (fs.existsSync(jsPath)) {
            fs.unlinkSync(jsPath);
        }

        return module.default;
    }

    // Handle JavaScript files directly
    return await import(fullPath);
}
