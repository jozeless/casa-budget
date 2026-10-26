const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('main logo embeds the original square crop without external dependencies',()=>{
 const svg=fs.readFileSync(path.join(root,'icon.svg'),'utf8');
 assert.match(svg,/viewBox="0 0 760 760"/);
 const embedded=svg.match(/href="data:image\/png;base64,([^"]+)"/);
 assert(embedded);
 const png=Buffer.from(embedded[1],'base64');
 assert.equal(png.readUInt32BE(16),760);
 assert.equal(png.readUInt32BE(20),760);
 assert(!svg.includes('<text'));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/<img class="brand-icon" src="icon.svg"[^>]*><b>CASA<\/b>/);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest')));
 assert(manifest.icons.some(icon=>icon.src==='icon.svg'));
});
