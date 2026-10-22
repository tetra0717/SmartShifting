// Object identification from measured display colour histories. No Gaussian PSF,
// image-shape match, absolute RGB lookup, or synchronized camera clock is used.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function colourResponse(a,b){
  // A completely free colour matrix can manufacture a match to another short
  // code. Use a bounded, nonnegative response with ridge regularisation.
  const v=[0,0,0];for(let pass=0;pass<18;pass++)for(let k=0;k<3;k++){
    let cross=0;for(let j=0;j<3;j++)if(j!==k)cross+=a[k*3+j]*v[j];v[k]=clamp((b[k]-cross)/a[k*3+k],0,6);
  }return v;
}
function fit(x,y,diagonal=false){
  const n=x.length,mx=[0,0,0],my=[0,0,0];for(let i=0;i<n;i++)for(let k=0;k<3;k++){mx[k]+=x[i][k]/n;my[k]+=y[i][k]/n;}
  const a=new Array(9).fill(0),b=Array.from({length:3},()=>[0,0,0]);let energy=0;
  for(let i=0;i<n;i++)for(let k=0;k<3;k++){const u=x[i][k]-mx[k];for(let j=0;j<3;j++){a[k*3+j]+=u*(x[i][j]-mx[j]);b[j][k]+=u*(y[i][j]-my[j]);}energy+=(y[i][k]-my[k])**2;}
  const ridge=Math.max(0.01,(a[0]+a[4]+a[8])*.025);for(let k=0;k<3;k++)a[k*3+k]+=ridge;
  const matrix=b.map((v,k)=>diagonal?[0,1,2].map(j=>j===k?clamp(v[k]/a[k*3+k],0,6):0):colourResponse(a,v)),model={mx,my,matrix};
  const result=verify(model,x,y);return {...model,...result,rms:Math.sqrt(energy/(n*3))};
}
function verify(model,x,y){let error=0,energy=0;for(let i=0;i<x.length;i++)for(let k=0;k<3;k++){let p=model.my[k];for(let j=0;j<3;j++)p+=model.matrix[k][j]*(x[i][j]-model.mx[j]);error+=(y[i][k]-p)**2;energy+=(y[i][k]-model.my[k])**2;}return {score:Math.sqrt(Math.max(0,1-error/Math.max(1e-8,energy))),error,energy};}
function frameAt(history,t){if(t<history[0].t||t>history.at(-1).t)return null;let a=0,b=history.length-1;while(a<b){const m=Math.ceil((a+b)/2);if(history[m].t<=t)a=m;else b=m-1;}const f=history[a],next=history[a+1];return next?{...f,next,blend:(t-f.t)/(next.t-f.t)}:f;}
function observations(history,samples,lag,exposure){
  const end=history.at(-1).t,latest=samples.at(-1).t;
  return samples.map(s=>{const t=end-lag+s.t-latest;const frames=[t-exposure/6,t-exposure/2,t-exposure*5/6].map(t=>frameAt(history,t));return frames.every(Boolean)?frames:null;});
}
function template(aligned,object,anchor){return aligned.map(frames=>{const v=[0,0,0];for(const f of frames)for(let k=0;k<3;k++){
  const j=anchor*3+k,value=f.objects[object][j];v[k]+=(anchor===5&&f.next?value+(f.next.objects[object][j]-value)*f.blend:value)/frames.length;
}return v;});}
function linearNull(train,test){
  const t0=train[0].t,tx=train.map(s=>(s.t-t0)/1000),mt=tx.reduce((a,b)=>a+b,0)/tx.length,my=[0,0,0];
  for(const s of train)for(let k=0;k<3;k++)my[k]+=s.rgb[k]/train.length;
  const variance=tx.reduce((v,t)=>v+(t-mt)**2,0),slopes=my.map((mean,k)=>train.reduce((v,s,i)=>v+(tx[i]-mt)*(s.rgb[k]-mean),0)/Math.max(1e-9,variance));
  const m={mx:[mt,0,0],my,matrix:slopes.map(v=>[v,0,0])};
  return verify(m,test.map(s=>[(s.t-t0)/1000,0,0]),test.map(s=>s.rgb));
}
export function decodeObjects(history,samples,config,options={}){
  const base={valid:false,duration:samples.length?samples.at(-1).t-samples[0].t:0};
  const reject=reason=>({...base,reason});
  if(!config.strength)return reject('揺らぎを停止しています');
  const early=!!options.early,holdout=early?4:5;
  if(samples.length<(early?13:16)||base.duration<(early?350:550)||history.length<12)return reject('新しいカメラ画像を収集中');
  if(samples.some((s,i)=>i&&s.t-samples[i-1].t>140))return reject('撮影フレームの間隔が空いています');
  if(samples.reduce((v,s)=>v+s.clipped,0)/samples.length>.3)return reject('黒つぶれ・白飛びが多すぎます');
  const split=samples.length-holdout,train=samples.slice(0,split),test=samples.slice(split),y=train.map(s=>s.rgb),ty=test.map(s=>s.rgb);
  const best=Array(config.count).fill(null);let rms=0;
  for(let lag=0;lag<=400;lag+=25)for(const exposure of [6,18,32]){
    const all=observations(history,samples,lag,exposure);if(!all.every(Boolean))continue;
    for(let object=0;object<config.count;object++)for(const anchor of early&&history[0].objects[object].length>=18?[5]:Array.from({length:history[0].objects[object].length/3},(_,i)=>i)){
      const x=template(all,object,anchor),model=fit(x.slice(0,split),y,early&&anchor!==5);rms=model.rms;
      if(!best[object]||model.score>best[object].score)best[object]={object,anchor,lag,exposure,model,score:model.score};
    }
  }
  if(rms<.65)return {...reject('揺らぎの時間変化がカメラに十分届いていません'),rms};
  // Refine only using the training frames. Five later frames never choose the
  // object, location within it, delay, exposure, or colour response coefficients.
  for(let object=0;object<config.count;object++){
    const seed=best[object];if(!seed)continue;
    for(let lag=Math.max(0,seed.lag-12);lag<=Math.min(400,seed.lag+12);lag+=6){
      const all=observations(history,samples,lag,seed.exposure);if(!all.every(Boolean))continue;
      const x=template(all,object,seed.anchor),model=fit(x.slice(0,split),y,early&&seed.anchor!==5);
      if(model.score>best[object].score)best[object]={...seed,lag,model,score:model.score};
    }
  }
  const ranked=best.filter(Boolean).sort((a,b)=>b.score-a.score);if(ranked.length<config.count)return reject('PCの表示履歴が不足しています');
  for(const item of ranked){const all=observations(history,samples,item.lag,item.exposure);item.check=verify(item.model,template(all, item.object,item.anchor).slice(split),ty);}
  const winner=ranked[0],other=ranked.slice(1).sort((a,b)=>a.check.error-b.check.error)[0];
  const margin=(other.check.error-winner.check.error)/Math.max(.25,other.check.error),nullCheck=linearNull(train,test);
  const result={...base,object:winner.object,score:winner.score,validation:winner.check.score,margin,rms,lag:winner.lag,exposure:winner.exposure,ranking:ranked.map(v=>({object:v.object,score:v.score,validation:v.check.score}))};
  if(winner.score<(early?.92:.82))return {...result,reason:'どのオブジェクトの揺らぎとも十分一致しません'};
  if(winner.check.score<(early?.88:.72))return {...result,reason:'後続フレームで一致を確認できません'};
  if(margin<(early?.55:.28))return {...result,reason:'別のオブジェクトとの差が小さいため未確定'};
  if(winner.check.error>Math.max(.25,nullCheck.error)*(early?.35:.55))return {...result,reason:'単なる明るさの変化と区別できません'};
  const accepted={...result,valid:true,state:'acquired',method:early?'early':'full',reason:early?'短い観測で対象を識別':'揺らぎからオブジェクトを識別'};
  // Internal calibration is retained per phone, never transmitted to the UI.
  Object.defineProperty(accepted,'solution',{value:{...winner,offset:history.at(-1).t-winner.lag-samples.at(-1).t}});
  return accepted;
}

function atOffset(history,samples,offset,exposure){return samples.map(s=>{const frames=[1/6,1/2,5/6].map(f=>frameAt(history,s.t+offset-exposure*f));return frames.every(Boolean)?frames:null;});}
function continuingScore(model,x,y){
  const result=verify(model,x,y),residual=[0,0,0],mean=[0,0,0];let energy=0;
  for(let i=0;i<y.length;i++)for(let k=0;k<3;k++){let p=model.my[k];for(let j=0;j<3;j++)p+=model.matrix[k][j]*(x[i][j]-model.mx[j]);residual[k]+=(y[i][k]-p)/y.length;mean[k]+=y[i][k]/y.length;}
  for(const v of y)for(let k=0;k<3;k++)energy+=(v[k]-mean[k])**2;
  const centred=Math.max(0,result.error-y.length*residual.reduce((v,a)=>v+a*a,0));
  return {...result,score:Math.sqrt(Math.max(0,1-centred/Math.max(1e-8,energy))),rms:Math.sqrt(energy/(y.length*3)),bias:Math.hypot(...residual)/Math.sqrt(3),residual};
}
function tailRms(samples){const tail=samples.slice(-4),mean=[0,0,0];for(const s of tail)for(let k=0;k<3;k++)mean[k]+=s.rgb[k]/tail.length;let energy=0;for(const s of tail)for(let k=0;k<3;k++)energy+=(s.rgb[k]-mean[k])**2;return Math.sqrt(energy/(tail.length*3));}
export class ObjectReceiver {
  constructor(){this.reset();}
  reset(){this.lock=null;this.revision=null;this.lastInput=-Infinity;this.lastSearch=-Infinity;}
  update(history,samples,config){
    if(!samples.length)return {valid:false,held:false,state:'searching',reason:'画像を収集中'};
    const end=samples.at(-1).t;
    if(this.revision!==config.revision||end<this.lastInput||end-this.lastInput>500)this.reset();
    this.revision=config.revision;this.lastInput=end;
    const intervals=samples.slice(-7).slice(1).map((s,i)=>s.t-samples.slice(-7)[i].t).sort((a,b)=>a-b);
    const recentMs=clamp((intervals[Math.floor(intervals.length/2)]||33)*6,210,300),fresh=samples.filter(s=>s.t>=end-recentMs);
    if(!config.strength||fresh.some(s=>s.clipped>.6)||fresh.some((s,i)=>i&&s.t-fresh[i-1].t>140)){this.lock=null;return {valid:false,held:false,state:'lost',reason:'信号停止・飽和・撮影間隔を確認してください'};}
    let continuing=null;
    if(this.lock&&end>this.lock.lastChecked&&fresh.length>=5){
      const lock=this.lock;let best=null;
      for(const delta of [0,-12,12,-24,24]){
        const aligned=atOffset(history,fresh,lock.solution.offset+delta,lock.solution.exposure);if(!aligned.every(Boolean))continue;
        const x=template(aligned,lock.object,lock.solution.anchor),check=continuingScore(lock.solution.model,x,fresh.map(s=>s.rgb));
        if(!best||check.score>best.score)best={...check,delta};
      }
      lock.lastChecked=end;
      if(best&&best.rms>=.35&&tailRms(fresh)>=.15&&best.score>=.62&&best.bias<=12){
        lock.lastPositive=end;lock.solution.offset+=best.delta*.25;
        // Only a slowly varying offset is updated here. ID/gain/anchor are not
        // refitted from the same short block used for continuing verification.
        for(let k=0;k<3;k++)lock.solution.model.my[k]+=clamp(best.residual[k]*.04,-.12,.12);
        continuing={valid:true,held:false,state:'tracking',method:'continuing',object:lock.object,score:lock.score,validation:best.score,margin:lock.margin,rms:best.rms,duration:end-fresh[0].t,reason:'取得した対象の新しい揺らぎを継続確認'};
        if(end-this.lastSearch<650)return continuing;
      }
    }
    if(this.lock&&end-this.lock.lastPositive>250)this.lock=null;
    // Refit at most every 200ms after acquisition, rather than running the full
    // unknown-ID / unknown-camera search on every overlapping camera window.
    if(!this.lock||end-this.lastSearch>=200){
      this.lastSearch=end;const short=samples.filter(s=>s.t>=end-440),long=samples.filter(s=>s.t>=end-850);
      let result=decodeObjects(history,short,config,{early:true});
      if(!result.valid&&long.length>=16&&end-long[0].t>=550)result=decodeObjects(history,long,config);
      if(result.valid){
        // A recalibration must still be supported by recent, changing frames;
        // old samples from before the phone was removed cannot extend a lock.
        const aligned=atOffset(history,fresh,result.solution.offset,result.solution.exposure);
        const recent=aligned.every(Boolean)?continuingScore(result.solution.model,template(aligned,result.object,result.solution.anchor),fresh.map(s=>s.rgb)):null;
        if(recent&&recent.rms>=.35&&tailRms(fresh)>=.15&&recent.score>=.62&&recent.bias<=12){this.lock={object:result.object,solution:result.solution,lastPositive:end,lastChecked:end,score:result.score,margin:result.margin};return result;}
        result={valid:false,state:'searching',reason:'直近の揺らぎを確認中'};
      }
      if(!this.lock)return {...result,held:false,state:'searching'};
    }
    if(continuing)return continuing;
    if(this.lock)return {valid:false,held:true,state:'rechecking',object:this.lock.object,score:this.lock.score,margin:this.lock.margin,signalAgeMs:end-this.lock.lastPositive,reason:'対象を保持して短い信号低下を再確認中'};
    return {valid:false,held:false,state:'searching',reason:'新しい対象の揺らぎを収集中'};
  }
}
