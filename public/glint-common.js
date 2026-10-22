export const NAMES=['蒼い剣','紫の結晶','翠の盾','琥珀の鍵','紅い宝珠','銀の羽','星の杖','月の欠片','炎の指輪','氷の槍','雷の石','森の冠','光の鏡','影の短剣','海の貝殻','風の笛','金の杯','虹の紋章','竜の鱗','時の砂時計'];
export function layout(count,width,height){
  const cols=count>12?5:count>9?4:Math.min(3,count),rows=Math.ceil(count/cols),gap=Math.min(width,height)*.025;
  const w=(width-gap*(cols+1))/cols,h=(height-gap*(rows+1))/rows;
  return Array.from({length:count},(_,id)=>({id,name:NAMES[id],x:gap+(id%cols)*(w+gap),y:gap+Math.floor(id/cols)*(h+gap),w,h}));
}
function hash(n){n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return (n^(n>>>16))>>>0;}
// Aperiodic, independently seeded envelopes, not cyclic shifts of one code.
// Smooth full-surface modulation survives spatial averaging; diagonal streaks
// provide the visual glint but are not the sole carrier of the object identity.
export function envelope(id,time,channel=0){
  const phase=time/65,n=Math.floor(phase),f=phase-n,s=(1-Math.cos(Math.PI*f))/2;
  const at=k=>hash((k>>>0)^Math.imul(id+1,0x9e3779b9)^Math.imul(channel+1,0x85ebca6b))/4294967295*2-1;
  return at(n)+(at(n+1)-at(n))*s;
}
export function cropStats(rgba,width=64){
  const sum=[0,0,0];let clipped=0,n=0;const lo=Math.round(width*.2),hi=width-lo;
  for(let y=lo;y<hi;y++)for(let x=lo;x<hi;x++){const i=(y*width+x)*4;n++;for(let k=0;k<3;k++)sum[k]+=rgba[i+k];if(rgba[i]<3||rgba[i+1]<3||rgba[i+2]<3||rgba[i]>252||rgba[i+1]>252||rgba[i+2]>252)clipped++;}
  return {rgb:sum.map(v=>v/n),clipped:clipped/n};
}
