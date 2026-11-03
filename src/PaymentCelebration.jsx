import React,{useEffect,useState} from 'react';
import {Check,Volume2,VolumeX,X} from 'lucide-react';
import {money} from '../shared/calculations.js';

export default function PaymentCelebration({payment,audio,onClose}) {
  const [muted,setMuted]=useState(audio.muted),[playing,setPlaying]=useState(false);
  useEffect(()=>{
    if(document.hidden){onClose();return()=>audio.stop();}
    let alive=true;
    void audio.play().then(ok=>{if(alive)setPlaying(ok);});
    const timer=setTimeout(onClose,8000);
    const hidden=()=>{if(document.hidden)onClose();};
    const escape=e=>{if(e.key==='Escape')onClose();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('keydown',escape);
    return()=>{alive=false;clearTimeout(timer);audio.stop();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('keydown',escape);};
  },[payment.id,audio,onClose]);
  return <div className="payment-celebration">
    <div className="dollar-rain" aria-hidden="true">{Array.from({length:26},(_,i)=><span key={i} className="falling-dollar" style={{left:`${(i*41)%100}%`,'--delay':`${(i%8)*.18}s`,'--duration':`${3.5+(i%6)*.25}s`,'--drift':`${(i%2?1:-1)*(20+i%4*15)}px`,'--rotation':`${(i%2?1:-1)*(80+i*13)}deg`}}><span>$</span></span>)}</div>
    <section className="payment-thanks" aria-label="Payment celebration">
      <button type="button" className="icon-button celebration-close" aria-label="Close celebration" onClick={onClose}><X size={20}/></button>
      <div role="status" aria-live="polite"><span className="celebration-check"><Check size={24}/></span><h2>Thank you for paying!</h2><p>{money(payment.amount)} reported to {payment.recipient}.</p><small>Waiting for confirmation</small></div>
      {audio.configured&&<div className="celebration-sound"><button type="button" className="text-button" onClick={()=>{const next=!muted;audio.setMuted(next);setMuted(next);if(!next){audio.prime();void audio.play().then(setPlaying);}else setPlaying(false);}}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>} {muted?'Sound off':'Mute sound'}</button>{!muted&&!playing&&<button type="button" className="text-button" onClick={()=>{audio.prime();void audio.play().then(setPlaying);}}>Play celebration sound</button>}</div>}
    </section>
  </div>;
}
