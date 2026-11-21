const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage();
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:8777/items.html');await p.waitForFunction(()=>window.READY,null,{timeout:60000});
console.log('anchor',JSON.stringify(await p.evaluate(()=>window.ANCHOR)));
fs.mkdirSync('out/items',{recursive:true});
for(const n of require('fs').readdirSync('items').filter(f=>f.endsWith('.glb')).map(f=>f.slice(0,-4))){const r=await p.evaluate(u=>window.renderItem(u),'items/'+n+'.glb');
 fs.writeFileSync('out/items/'+n+'.png',Buffer.from(r.url.split(',')[1],'base64'));console.log(n,r.size.map(v=>v.toFixed(2)).join(' '));}
await b.close();})();
