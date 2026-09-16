// SPDX-License-Identifier: Apache-2.0
import {spawn} from 'node:child_process';import {existsSync,readFileSync,mkdirSync} from 'node:fs';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),lock=JSON.parse(readFileSync(join(root,'apps/desktop/runtime-lock.json'),'utf8'));
const flag=process.argv.indexOf('--runtime'),dir=flag>=0?resolve(process.argv[flag+1]):join(root,'.cache','desktop',`electron-${lock.version}-${process.platform}-${process.arch}`),binary=join(dir,process.platform==='win32'?'electron.exe':'electron');
if(!existsSync(binary))throw Error('Verified Electron runtime missing. Run the explicit desktop-runtime helper or supply --runtime.');
const output=join(root,'.cache','desktop-test');mkdirSync(output,{recursive:true});let file=binary,args=[join(root,'apps/desktop/test')];
if(process.platform==='linux'&&!process.env.DISPLAY){file='/usr/bin/xvfb-run';if(!existsSync(file))throw Error('An X display or xvfb-run is required; the renderer sandbox will not be disabled.');args=['-a',binary,...args];}
const env={...process.env,SIGLUM_TEST_OUTPUT:output};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const child=spawn(file,args,{cwd:root,env,stdio:'inherit',shell:false});const timer=setTimeout(()=>child.kill(),180000);child.once('error',()=>{clearTimeout(timer);process.exitCode=1;});child.once('exit',code=>{clearTimeout(timer);process.exitCode=code??1;});
