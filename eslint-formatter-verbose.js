// Custom ESLint formatter: prints every checked file, not just those with issues.
export default function verboseFormatter(results) {
    const cwd = process.cwd();
    let out = '';
    let totalErrors = 0, totalWarnings = 0;

    for (const result of results) {
        const rel  = result.filePath.startsWith(cwd)
            ? result.filePath.slice(cwd.length + 1)
            : result.filePath;
        const mark = result.errorCount > 0 ? '✗' : result.warningCount > 0 ? '!' : '✓';
        out += `${mark} ${rel}\n`;

        for (const msg of result.messages) {
            const type = msg.severity === 2 ? 'error  ' : 'warning';
            const loc  = `${msg.line}:${String(msg.column).padEnd(3)}`;
            out += `    ${loc}  ${type}  ${msg.message}  (${msg.ruleId})\n`;
        }

        totalErrors   += result.errorCount;
        totalWarnings += result.warningCount;
    }

    const summary = totalErrors + totalWarnings === 0
        ? `\n${results.length} files — all clean`
        : `\n${results.length} files — ${totalErrors} error(s), ${totalWarnings} warning(s)`;
    return out + summary + '\n';
}
