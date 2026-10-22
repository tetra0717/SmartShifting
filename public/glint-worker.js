import {ObjectReceiver} from './glint-receiver.js';
const receivers=new Map();
onmessage=({data})=>{const start=performance.now();try{
  for(const [id,r] of receivers)if(start-r.at>10000)receivers.delete(id);
  let entry=receivers.get(data.id);if(!entry){entry={receiver:new ObjectReceiver()};receivers.set(data.id,entry);}entry.at=start;
  postMessage({...entry.receiver.update(data.history,data.samples,{...data.config,revision:`${data.config.revision}:${data.epoch??0}`}),processingMs:performance.now()-start});
}catch(e){receivers.delete(data.id);postMessage({valid:false,held:false,state:'lost',reason:e.message,processingMs:performance.now()-start});}};
