const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const lines = content.split('\n');
const startIdx = lines.findIndex(l => l.includes('STORAGE_KEY_LEGACY'));
if (startIdx !== -1) {
    // Find the enclosing <script> relative to startIdx
    let scriptStart = startIdx;
    while (scriptStart >= 0 && !lines[scriptStart].includes('<script>')) {
        scriptStart--;
    }
    // Find the closing </script>
    let scriptEnd = startIdx;
    while (scriptEnd < lines.length && !lines[scriptEnd].includes('</script>')) {
        scriptEnd++;
    }
    if (scriptStart !== -1 && scriptEnd !== -1) {
        lines.splice(scriptStart, scriptEnd - scriptStart + 1);
        fs.writeFileSync('index.html', lines.join('\n'));
        console.log('Removed inline script block from lines', scriptStart, 'to', scriptEnd);
    } else {
        console.log('Could not find script bounds');
    }
} else {
    console.log('Inline script not found');
}
