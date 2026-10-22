import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {cropStats,NAMES} from '../public/glint-common.js';
async function client(){
  const elements=new Map(),intervals=[],requests=[],events=[],clock={now:1000};let frame;
  const pixels=new Uint8ClampedArray(64*64*4).fill(128),context={drawImage(){},getImageData:()=>({data:pixels})};
  const node=id=>{if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',dataset:{},getContext:()=>context,replaceChildren(){},videoWidth:640,videoHeight:480,readyState:2,play:async()=>{},requestVideoFrameCallback:cb=>{frame=cb;}});return elements.get(id);};
  const document={getElementById:node,addEventListener(){},hidden:false,createElement:()=>({click(){}})};
  class EventSource{constructor(){this.listeners=new Map();events.push(this);}addEventListener(name,cb){this.listeners.set(name,cb);}emit(name,data){this.listeners.get(name)?.({data:JSON.stringify(data)});}}
  const track={stop(){},getSettings:()=>({frameRate:30}),addEventListener(){}};
  const sandbox={document,EventSource,cropStats,NAMES,createDiagnostics:()=>({log(){},error(){},download(){}}),crypto:{randomUUID:()=> 'test-phone'},isSecureContext:true,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]}),enumerateDevices:async()=>[]}},Option:class{},performance:{now:()=>clock.now},setInterval:cb=>intervals.push(cb),addEventListener(){},fetch:async(path,options)=>{requests.push({path,data:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};}};
  vm.createContext(sandbox);vm.runInContext((await readFile(new URL('../public/glint-phone.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,''),sandbox);
  const es=events[0];es.emit('config',{revision:1,count:20,strength:.8});es.emit('status',{online:true});await node('start').onclick();
  let n=0;const tick=async()=>{clock.now+=1000/30;const cb=frame;cb(clock.now,{mediaTime:++n/30});await new Promise(setImmediate);};
  for(let i=0;i<12;i++)await tick();
  const packet=()=>requests.findLast(r=>r.path.endsWith('/samples')).data;
  const emit=(patch={})=>{const p=packet();es.emit('result',{id:p.id,epoch:p.epoch,seq:p.seq,revision:p.revision,sourceTime:p.samples.at(-1).t,valid:true,held:false,state:'tracking',object:19,score:.96,validation:.9,margin:.8,...patch});};
  return {node,clock,intervals,tick,packet,emit};
}
test('phone keeps the target label during a brief recheck and clears it on loss',async()=>{
  const c=await client();c.emit();assert.equal(c.node('object').textContent,NAMES[19]);
  await c.tick();await c.tick();await c.tick();c.emit({valid:false,held:true,state:'rechecking'});assert.equal(c.node('object').textContent,NAMES[19]);assert.equal(c.node('state').dataset.valid,'held');
  await c.tick();await c.tick();await c.tick();c.emit({valid:false,held:false,state:'searching',object:null,reason:'信号なし'});assert.equal(c.node('object').textContent,'—');
});
test('reset rejects old camera-session results and absence of fresh results expires the UI',async()=>{
  const c=await client();c.emit();const old=c.packet();c.node('reset').onclick();
  for(let i=0;i<12;i++)await c.tick();assert.notEqual(c.packet().epoch,old.epoch);
  c.emit({epoch:old.epoch});assert.equal(c.node('object').textContent,'—');c.emit();assert.equal(c.node('object').textContent,NAMES[19]);
  c.clock.now+=500;for(const callback of c.intervals)callback();assert.equal(c.node('object').textContent,'—');
});
