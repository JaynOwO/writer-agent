// SPDX-License-Identifier: Apache-2.0
import { DesktopApplication, desktopError } from '../cli/dist/application/desktop.js';
import { ConnectionStore } from '../cli/dist/application/presets.js';
import { APP_METHODS } from './contract.mjs';
let service; let serial=Promise.resolve();
const port=process.parentPort;
if(!port)throw Error('Desktop worker requires a host.');
port.on('message',({data})=>{
 serial=serial.then(async()=>{
  const {id,method,input}=data;
  try{
   if(!Number.isSafeInteger(id))throw Error('Invalid request.');
   if(method==='initialize'){if(service)throw Error('Already initialized.');service=new DesktopApplication(input.configDirectory?new ConnectionStore(input.configDirectory):new ConnectionStore());port.postMessage({id,ok:true,value:{ready:true,versions:{node:process.versions.node,electron:process.versions.electron,sqlite:process.versions.sqlite}}});return;}
   if(!service)throw Error('Not initialized.');
   let value;
   switch(method){
    case 'host:open':value=service.openWorkspace(input.path,input.create,input.name);break;
    case 'host:migrationPreview':value=service.migrationPreview();break;
    case 'host:migrate':value=service.migrateCurrent();break;
    case 'host:importDocument':value=service.importDocument(input.title,input.text);break;
    case 'host:importSource':value=service.importSource(input.name,input.raw,input.mediaType);break;
    case 'host:exportDocument':value=service.exportDocument(input.id);break;
    case 'host:exportReport':value=service.exportReport(input);break;
    case 'host:close':await service.close();value={closed:true};break;
    default:if(!APP_METHODS.includes(method))throw Error('Unknown worker capability.');value=await service.request(method,input);
   }
   port.postMessage({id,ok:true,value});
  }catch(e){port.postMessage({id,ok:false,error:desktopError(e)});}
 }).catch(()=>{});
});
