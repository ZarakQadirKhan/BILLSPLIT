// User-supplied clip, hosted with the app; no external music service.
export const paymentAudio = {src:'/audio/paisa.m4a',startSeconds:0,durationSeconds:8};

export function createCelebrationAudio(config=paymentAudio,options={}) {
  let storage;try{storage=options.storage??globalThis.localStorage;}catch{}
  const AudioContext=options.AudioContext??globalThis.AudioContext??globalThis.webkitAudioContext;
  const fetchAudio=options.fetch??globalThis.fetch;
  const key='paisay-dou-celebration-muted';
  let muted=false,context,bufferPromise,source,generation=0;
  try {muted=storage?.getItem(key)==='true';}catch{}
  const stop=()=>{generation++;if(source){try{source.stop();source.disconnect();}catch{}source=null;}};
  function prime() {
    if(!config.src||muted||!AudioContext)return;
    try {
      context??=new AudioContext();
      // Called directly from the payment button's user gesture for iPhone Safari.
      void context.resume().catch(()=>{});
      bufferPromise??=fetchAudio(config.src,{signal:AbortSignal.timeout(10000)})
        .then(r=>{if(!r.ok)throw Error('Audio unavailable');return r.arrayBuffer();})
        .then(bytes=>context.decodeAudioData(bytes)).catch(()=>{bufferPromise=null;return null;});
    }catch{}
  }
  async function play() {
    stop();const ticket=generation;
    if(!config.src||muted||!context)return false;
    const buffer=await bufferPromise;
    if(!buffer||ticket!==generation||muted||context.state!=='running')return false;
    const offset=Math.max(0,config.startSeconds||0),duration=Math.min(8,config.durationSeconds||8,buffer.duration-offset);
    if(duration<=0)return false;
    try {source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start(0,offset,duration);return true;}catch{stop();return false;}
  }
  return {configured:!!config.src,get muted(){return muted;},prime,play,stop,
    setMuted(value){muted=value;if(value)stop();try{storage?.setItem(key,String(value));}catch{}},
    dispose(){stop();if(context)void context.close().catch(()=>{});}
  };
}
