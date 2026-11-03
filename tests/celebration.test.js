import test from 'node:test';
import assert from 'node:assert/strict';
import {createCelebrationAudio} from '../src/celebration-audio.js';

test('missing song never makes a media request or opens an audio context',async()=>{
  const audio=createCelebrationAudio({src:null},{AudioContext:class{constructor(){assert.fail('No audio configured');}},fetch:()=>assert.fail('No media request expected')});
  audio.prime();assert.equal(await audio.play(),false);audio.stop();audio.dispose();
});

test('celebration audio is gesture-primed, bounded, cancelable and remembers mute',async()=>{
  const saved=new Map(),starts=[];let stopped=0,resumed=0,resolveFetch;
  class Context {state='running';destination={};resume(){resumed++;return Promise.resolve();}close(){return Promise.resolve();}decodeAudioData(){return Promise.resolve({duration:30});}createBufferSource(){return {connect(){},disconnect(){},start(...args){starts.push(args);},stop(){stopped++;}};}}
  const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
  const audio=createCelebrationAudio({src:'/synthetic-test.mp3',startSeconds:2,durationSeconds:20},{AudioContext:Context,storage,fetch:()=>new Promise(r=>resolveFetch=r)});
  audio.prime();assert.equal(resumed,1,'audio is unlocked during the button gesture');
  const delayed=audio.play();audio.stop();resolveFetch({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
  assert.equal(await delayed,false,'closing before decoding must prevent late playback');
  assert.equal(starts.length,0);
  assert.equal(await audio.play(),true);assert.deepEqual(starts,[[0,2,8]],'clip is limited to eight seconds');
  audio.setMuted(true);assert.equal(stopped,1);assert.equal(await audio.play(),false);
  const next=createCelebrationAudio({src:'/synthetic-test.mp3'},{storage});assert.equal(next.muted,true);
  audio.dispose();
});
