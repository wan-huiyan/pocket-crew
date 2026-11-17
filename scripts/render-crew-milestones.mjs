// Use ImageGen character art with exact 2026 event markers. The map geometry originated in 2025.
// This script creates the downloadable milestone posters and their thumbnails.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import {createHash} from 'node:crypto';

const dir=new URL('../public/',import.meta.url),assetUrl=new URL('assets/surprises/',dir);
const json=async path=>JSON.parse(await readFile(new URL(path,dir),'utf8'));
const guide=await json('data/guide-data.json');
const route=(await json('data/route.geojson')).coordinates;
const manifest=await json('data/poster-manifest.json');
const base=await readFile(new URL('assets/art/crew-trio-base.png',dir));
const W=1080,H=1800;
const rad=Math.PI/180;
const distance=(a,b)=>{
 const y=(b[1]-a[1])*rad,x=(b[0]-a[0])*rad;
 const s=Math.sin(y/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(x/2)**2;
 return 12742.0176*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));
};
const distances=[0];
for(let i=1;i<route.length;i++)distances.push(distances.at(-1)+distance(route[i-1],route[i]));
const scale=guide.routeKm/distances.at(-1);
const points=route.map((p,i)=>({lng:p[0],lat:p[1],km:distances[i]*scale}));
const safe=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const themes={
 'km-50':{heading:'THE LONG WAY TO COFFEE',colour:'#bd0c27',place:'THE NEXT CHAPTER'},
 'km-60':{heading:'POWERED BY TOFU',colour:'#ca3317',place:'TOWCESTER AREA'},
 'km-70':{heading:'PROPERLY PROUD OF YOU',colour:'#ba1a2f',place:'POTTERSPURY AREA'},
 'km-80':{heading:'KEEP THAT CROW FLYING',colour:'#cf4a14',place:'MILTON KEYNES'},
 'km-90':{heading:'EVERY STEP COUNTS',colour:'#bc0d30',place:'BEYOND MILTON KEYNES'},
 'km-100':{heading:'ONE HUNDRED. ALL HEART.',colour:'#a91228',place:'TOWARDS DUNSTABLE'},
 gold:{heading:'FLIGHT RISK: GOLD!',colour:'#b88a15',place:'DUNSTABLE AREA'},
 'km-110':{heading:'THE ESCAPE CONTINUES',colour:'#bb1531',place:'THE ONWARD ROUTE'},
 'km-120':{heading:'YOU ARE INCREDIBLE',colour:'#d05a15',place:'THE ONWARD ROUTE'},
 'km-123':{heading:'THE CROW IS SPEECHLESS',colour:'#b51a30',place:'123 KM PLANNING HORIZON'}
};
const next=(km)=>points.reduce((min,p)=>Math.abs(p.km-km)<Math.abs(min.km-km)?p:min);
function mapPath(km){
 const small=points.filter(p=>p.km>=Math.max(0,km-13)&&p.km<=Math.min(123,km+13));
 const anchor=next(km),all=[...small,anchor],loX=Math.min(...all.map(p=>p.lng)),hiX=Math.max(...all.map(p=>p.lng)),loY=Math.min(...all.map(p=>p.lat)),hiY=Math.max(...all.map(p=>p.lat));
 const width=Math.max(.0001,hiX-loX),height=Math.max(.0001,hiY-loY),sx=330/width,sy=120/height,k=Math.min(sx,sy);
 const x=p=>Math.round(772+(p.lng-(loX+hiX)/2)*k),y=p=>Math.round(1662-(p.lat-(loY+hiY)/2)*k);
 const routeLine=small.map((p,i)=>(i?'L':'M')+x(p)+' '+y(p)).join(' ');
 const dotX=x(anchor),dotY=y(anchor);
 return `<path d="${routeLine}" fill="none" stroke="#e4c5a1" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="${routeLine}" fill="none" stroke="#006c66" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="${dotX}" cy="${dotY}" r="20" fill="#fff5dd" stroke="#b70e26" stroke-width="6"/><circle cx="${dotX}" cy="${dotY}" r="7" fill="#b70e26"/>`;
}
function overlay(id,km,style){
 const big=id==='gold'?'GOLD!':km+' KM!';
 const titleSize=id==='gold'?160:174;
 const placeSize=style.place.length>16?27:style.place.length>12?35:44;
 return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
 <defs><filter id="shade"><feGaussianBlur stdDeviation="11"/></filter></defs>
 <rect x="34" y="32" width="1012" height="432" rx="24" fill="#ffeac5" opacity=".35"/>
 <text x="540" y="99" font-family="DejaVu Sans,Arial,sans-serif" font-weight="900" font-size="38" letter-spacing="4" text-anchor="middle" fill="#075f5c">EMILY’S GREAT ESCAPE</text>
 <path d="M172 127 Q540 143 910 127" fill="none" stroke="${style.colour}" stroke-width="11" stroke-linecap="round"/>
 <text x="540" y="315" font-family="DejaVu Sans,Arial,sans-serif" font-weight="1000" font-size="${titleSize}" letter-spacing="-8" text-anchor="middle" fill="${style.colour}">${safe(big)}</text>
 <text x="540" y="394" font-family="DejaVu Sans,Arial,sans-serif" font-weight="900" font-size="39" letter-spacing="1.2" text-anchor="middle" fill="#084f4b">${safe(style.heading)}</text>
 <text x="540" y="448" font-family="DejaVu Sans,Arial,sans-serif" font-weight="800" font-size="25" letter-spacing="3.5" text-anchor="middle" fill="#423a31">EMILY  ·  GRAHAM  ·  BEN</text>
 <rect x="0" y="1508" width="1080" height="292" fill="#fff1d2"/>
 <path d="M0 1510 H1080" stroke="${style.colour}" stroke-width="15"/>
 <text x="56" y="1575" font-family="DejaVu Sans,Arial,sans-serif" font-weight="900" font-size="28" letter-spacing="2" fill="#064e4a">MARKED ON THE MAP</text>
 <text x="56" y="1633" font-family="DejaVu Sans,Arial,sans-serif" font-weight="900" font-size="${placeSize}" fill="${style.colour}">${safe(style.place)}</text>
 <text x="56" y="1681" font-family="DejaVu Sans,Arial,sans-serif" font-size="25" font-weight="700" fill="#48423a">2026 EVENT ROUTE</text>
 <text x="56" y="1717" font-family="DejaVu Sans,Arial,sans-serif" font-size="22" fill="#48423a">● approximate distance dot</text>
 <text x="56" y="1754" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" fill="#48423a">Not a meeting / parking pin</text>
 <rect x="569" y="1553" width="458" height="185" rx="22" fill="#f9dcae" stroke="#b78e63" stroke-width="3"/>
 ${mapPath(km)}
 <text x="797" y="1591" font-family="DejaVu Sans,Arial,sans-serif" font-weight="900" font-size="23" text-anchor="middle" fill="#493a31">MERIDEN 2026 · 2025 MAP SOURCE</text>
 <text x="797" y="1730" font-family="DejaVu Sans,Arial,sans-serif" font-weight="900" font-size="23" text-anchor="middle" fill="${style.colour}">${id==='gold'?'GOLD TARGET ~106 KM':km+' KM ROUTE DOT'}</text>
 <text x="540" y="1776" font-family="DejaVu Sans,Arial,sans-serif" font-weight="800" font-size="17" letter-spacing=".3" text-anchor="middle" fill="#54443b">EMILY &amp; GRAHAM · WALKING TOGETHER     BEN · DRIVER FROM POINT 12     POWERED BY TOFU ♡</text>
 </svg>`);
}
await mkdir(assetUrl,{recursive:true});
const posterArt=await sharp(base).resize({width:W,height:1620,fit:'fill'}).toBuffer();
for(const [id,style]of Object.entries(themes)){
 const stop=guide.stops.find(s=>s.id===id),km=id==='gold'?105.9968:stop?.routeKm;
 if(!Number.isFinite(km))throw Error('Missing marker for '+id);
 const composite=await sharp({create:{width:W,height:H,channels:4,background:'#fff0cf'}})
  .composite([{input:posterArt,left:0,top:180},{input:overlay(id,km,style),left:0,top:0}]).png({compressionLevel:9}).toBuffer();
 const opaque=createHash('sha256').update('emily-graham-ben-123km-'+id+'-20261114').digest('hex').slice(0,24);
 const preview='assets/surprises/'+opaque+'.webp',download='assets/surprises/'+opaque+'.png';
 await writeFile(new URL(preview,dir),await sharp(composite).resize({width:720}).webp({quality:83,effort:5}).toBuffer());
 await writeFile(new URL(download,dir),composite);
 manifest[id]={preview,download,width:W,height:H};
 console.log(id,preview);
}
await writeFile(new URL('data/poster-manifest.json',dir),JSON.stringify(manifest)+'\n');
