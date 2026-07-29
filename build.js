/* build.js — regenerate the single-file site (index.html) from the sources.
 *
 *   node build.js
 *
 * The published site is a BUILD ARTIFACT: it inlines the model (engine_multi.js)
 * and the interface (ui_multi.js) into the HTML shell (index_template.html) so the
 * page is fully self-contained and works offline. Edit the sources, not index.html.
 */
const fs = require('fs');

const engine   = fs.readFileSync('engine_multi.js', 'utf8');
const ui       = fs.readFileSync('ui_multi.js', 'utf8');
const template = fs.readFileSync('index_template.html', 'utf8');

// function replacers avoid `$`-sequences in the source being treated as
// String.replace special patterns.
const out = template
  .replace('%%ENGINE%%', () => engine)
  .replace('%%UI%%', () => ui);

fs.writeFileSync('index.html', out);
console.log('Built index.html (' + Math.round(out.length / 1024) + ' KB) from sources.');
