// SPDX-License-Identifier: Apache-2.0
export const PAGE='siglum://app/index.html';
export const VERSION='0.0.9';
export const APP_METHODS=Object.freeze(['overview','diagnostics','document','documentCreate','bufferSave','bufferCommit','bufferDiscard','rangeSplit','rangeDecide','legacyDecide','profileCreate','profileAttach','profile','preferenceSave','preferenceDecide','intentSave','suggestPreview','reviewPreview','previewDiscard','previewSend','jobCancel','presetSave','presetRemove','probePreview','source','runCreate','run','runPreview','runAuthorize','runStart','runPause','runRecover','runRetry','runRefresh','runOutline','runReply','runAdopt','runFinish']);
export const HOST_METHODS=Object.freeze(['workspaceOpen','workspaceCreate','workspaceMigrate','importDocument','importSource','exportDocument','exportReport','windowDirty','externalSource','installationInfo','installCurrentUser']);
export function validateEnvelope(method,input){
 if(![...APP_METHODS,...HOST_METHODS].includes(method))throw Error('Unknown desktop capability.');
 const s=JSON.stringify(input);if(typeof s!=='string'||Buffer.byteLength(s)>6_000_000)throw Error('Oversized desktop request.');
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected an object.');
 return input;
}
export function validSender(event,window){return event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame?.url===PAGE;}
export function safeExternal(value){if(typeof value!=='string'||value.length>4096)throw Error('Invalid link.');const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Only explicit HTTP(S) source links are allowed.');return u.href;}
