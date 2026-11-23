import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const assets = {};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
async function scan(directory,prefix='') {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name),name=`${prefix}/${entry.name}`;
    if(entry.isDirectory())await scan(path,name);
    else {const extension=entry.name.slice(entry.name.lastIndexOf('.'));assets[name]={type:types[extension]||'application/octet-stream',body:(await readFile(path)).toString('base64')};}
  }
}
await scan('dist/client');
await mkdir('dist/server',{recursive:true});
const handler=await readFile('server/handler.mjs','utf8');
await writeFile('dist/server/index.js',`const staticAssets = ${JSON.stringify(assets)};\n${handler}`);
console.log(`Worker built with ${Object.keys(assets).length} local assets.`);
