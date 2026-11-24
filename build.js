const fs = require('fs');
const data = fs.readFileSync('darvas.json','utf8');
let html = fs.readFileSync('template.html','utf8');
html = html.replace('__DATA_JSON__', data);
fs.writeFileSync('index.html', html);
console.log('Wrote index.html (' + (html.length/1024).toFixed(0) + ' KB)');
