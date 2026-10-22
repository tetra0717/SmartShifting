import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeObjects,ObjectReceiver} from '../public/glint-receiver.js';
import {envelope} from '../public/glint-common.js';
const config={count:6,strength:.8};
function fixture(target,kind='code',count=6,endFrame=99){
  const history=Array.from({length:endFrame+1},(_,i)=>({t:i*1000/60,objects:Array.from({length:count},(_,id)=>{
    const a=envelope(id,i*1000/60),b=envelope(id,i*1000/60,1),rgb=[100+22*a+8*b,90+7*a-10*b,130+18*a+15*b];return Array.from({length:5},()=>rgb).flat();})}));
  const end=history.at(-1).t-75,samples=Array.from({length:23},(_,i)=>{
    const t=end-(22-i)*1000/30,frames=[t-4,t-12,t-20].map(t=>history.findLast(f=>f.t<=t));
    const rgb=[0,0,0];for(const f of frames)for(let k=0;k<3;k++)rgb[k]+=f.objects[target][k]/3;
    if(kind==='mixed')for(let k=0;k<3;k++)rgb[k]=(rgb[k]+frames.reduce((v,f)=>v+f.objects[(target+1)%count][k]/3,0))/2;
    if(kind==='flat')rgb.fill(128);
    if(kind==='trend')rgb.fill(110+i*.5);
    return {t:50000+t,rgb:[rgb[0]*.86+rgb[1]*.1+4,rgb[1]*1.07+3,rgb[2]*.88+rgb[0]*.05+6].map((v,k)=>v+(kind==='code'?.15*Math.sin(i*2.17+k):0)),clipped:0};
  });return {history,samples};
}
test('object identity survives an unknown clock, exposure integration, colour mixing and noise',()=>{
  for(const target of [0,2,5]){const {history,samples}=fixture(target),r=decodeObjects(history,samples,config);assert.equal(r.valid,true,JSON.stringify(r));assert.equal(r.object,target);}
});

test('twenty IDs retain discrimination; early acquisition never accepts a different ID',()=>{
  const c={count:20,strength:.8,revision:1};let early=0;
  for(const target of [0,4,9,14,19]){
    const {history,samples}=fixture(target,'code',20),full=decodeObjects(history,samples,c);assert.equal(full.valid,true,JSON.stringify(full));assert.equal(full.object,target);
    const short=decodeObjects(history,samples.slice(-13),c,{early:true});if(short.valid){early++;assert.equal(short.object,target);}
  }assert.ok(early>0,'strong short-window inputs should acquire early');
});
test('known-ID confirmation uses new frames, holds brief loss, then expires; phones stay independent',()=>{
  const c={count:20,strength:.8,revision:1},a=new ObjectReceiver(),b=new ObjectReceiver();
  for(const [receiver,id] of [[a,0],[b,19]]){const f=fixture(id,'code',20);const r=receiver.update(f.history,f.samples,c);assert.equal(r.valid,true,JSON.stringify(r));assert.equal(r.object,id);}
  const next=fixture(0,'code',20,105),tracked=a.update(next.history,next.samples,c);assert.equal(tracked.valid,true,JSON.stringify(tracked));assert.equal(tracked.method,'continuing');assert.equal(tracked.object,0);
  const brief=fixture(0,'flat',20,111),held=a.update(brief.history,brief.samples,c);assert.equal(held.valid,false);assert.equal(held.held,true,JSON.stringify(held));assert.equal(held.object,0);
  const lost=fixture(0,'flat',20,122),expired=a.update(lost.history,lost.samples,c);assert.equal(expired.valid,false);assert.equal(expired.held,false,JSON.stringify(expired));
  const other=fixture(19,'code',20,105),stable=b.update(other.history,other.samples,c);assert.equal(stable.valid,true);assert.equal(stable.object,19);
});
test('flat input, drift, equally mixed objects, insufficient frames and saturation remain unconfirmed',()=>{
  for(const kind of ['flat','trend','mixed']){const {history,samples}=fixture(0,kind),r=decodeObjects(history,samples,config);assert.equal(r.valid,false,`${kind}: ${JSON.stringify(r)}`);}
  const {history,samples}=fixture(0);assert.equal(decodeObjects(history,samples.slice(0,10),config).valid,false);assert.equal(decodeObjects(history,samples.map(s=>({...s,clipped:.8})),config).valid,false);
});
