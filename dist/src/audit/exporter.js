export function exportToJSON(entries, since) {
    const filtered = filterBySince(entries, since);
    return JSON.stringify(filtered, null, 2);
}
export function exportToCSV(entries, since) {
    const filtered = filterBySince(entries, since);
    if (filtered.length === 0)
        return "";
    const headers = [
        "timestamp",
        "toolName",
        "toolCallId",
        "decision",
        "policyRule",
        "severity",
        "userResponse",
        "executionResult",
        "durationMs",
    ];
    const lines = [headers.join(",")];
    for (const entry of filtered) {
        const values = headers.map((h) => {
            const val = entry[h];
            if (val === undefined || val === null)
                return "";
            const str = String(val);
            // Escape values containing commas or quotes
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        });
        lines.push(values.join(","));
    }
    return `${lines.join("\n")}\n`;
}
function filterBySince(entries, since) {
    if (!since)
        return entries;
    const match = since.match(/^(\d+)(m|h|d)$/);
    if (!match)
        return entries;
    const num = parseInt(match[1], 10);
    let ms;
    switch (match[2]) {
        case "m":
            ms = num * 60 * 1000;
            break;
        case "h":
            ms = num * 60 * 60 * 1000;
            break;
        case "d":
            ms = num * 24 * 60 * 60 * 1000;
            break;
        default:
            return entries;
    }
    const cutoff = new Date(Date.now() - ms).toISOString();
    return entries.filter((e) => e.timestamp >= cutoff);
}
//# sourceMappingURL=exporter.js.map