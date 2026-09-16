// SPDX-License-Identifier: Apache-2.0
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { WriterError } from '@writer-agent/core';
export class WizardCancelled extends Error {constructor(){super('Wizard cancelled; no implicit approval or request.');}}
export interface WizardIO { readonly signal?:AbortSignal; ask(prompt:string):Promise<string>; secret?(prompt:string):Promise<string>; line(text:string):void }
export function terminalText(text:string):string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'');
}
export function openTerminal(){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new WriterError('INVALID_INPUT','The numbered guide needs an interactive terminal (TTY). Use explicit CLI commands for scripts/pipes.');
  let muted=false;
  const output=new Writable({write(chunk,_encoding,done){if(!muted)process.stdout.write(chunk);done();}});
  Object.defineProperty(output,'isTTY',{value:true});Object.defineProperty(output,'columns',{get:()=>process.stdout.columns});
  const controller=new AbortController(),rl=createInterface({input:process.stdin,output,terminal:true,historySize:0});
  const cancel=()=>{controller.abort();rl.close();};
  rl.on('SIGINT',cancel);rl.on('close',()=>controller.abort());process.once('SIGTERM',cancel);
  const io:WizardIO={signal:controller.signal,secret:async prompt=>{
    if(controller.signal.aborted)throw new WizardCancelled();
    process.stdout.write(terminalText(prompt)+' (input hidden / 输入不回显): ');muted=true;
    try{const value=await rl.question('',{signal:controller.signal});if(controller.signal.aborted)throw new WizardCancelled();return value;}
    catch{throw new WizardCancelled();}
    finally{muted=false;process.stdout.write('\n');}
  },line:text=>console.log(terminalText(text)),ask:async prompt=>{
    if(controller.signal.aborted)throw new WizardCancelled();
    try{return await rl.question(terminalText(prompt),{signal:controller.signal});}
    catch{throw new WizardCancelled();}
  }};
  return {io,close:()=>{process.removeListener('SIGTERM',cancel);rl.close();}};
}
