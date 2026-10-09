/**
 * Secure CSV Exporter Utility
 * Enforces RFC 4180 formatting & prevents Spreadsheet Formula Injection (CSV Injection).
 */

function sanitizeCsvCell(value) {
    if (value === null || value === undefined) {
        return '""';
    }

    let str = String(value);

    // Prevent CSV Formula Injection
    // Characters =, +, -, @, tab, or carriage return at the start of a cell can be evaluated as formula code by MS Excel / LibreOffice
    const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
    if (dangerousPrefixes.some(prefix => str.startsWith(prefix))) {
        str = "'" + str;
    }

    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');

    // Wrap cell in double quotes
    return `"${str}"`;
}

function generateCsv(headers, rows) {
    const headerLine = headers.map(h => sanitizeCsvCell(h.label)).join(',');
    const dataLines = rows.map(row => {
        return headers.map(h => {
            const val = row[h.key];
            return sanitizeCsvCell(val);
        }).join(',');
    });

    return [headerLine, ...dataLines].join('\r\n');
}

function sendCsvResponse(res, filename, headers, rows) {
    const csvContent = generateCsv(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(200).send(csvContent);
}

module.exports = {
    sanitizeCsvCell,
    generateCsv,
    sendCsvResponse
};
