// SPDX-License-Identifier: Apache-2.0
import {app,dialog} from 'electron';
import {registerScheme,startDesktop} from './host.mjs';
import {scheduleUninstall} from './install.mjs';
app.setName('Siglum');app.setAppUserModelId('org.siglum.writer');
registerScheme();
if(process.argv.includes('--uninstall-local')){app.whenReady().then(async()=>{await scheduleUninstall();app.quit();}).catch(()=>{dialog.showErrorBox('Siglum uninstall stopped','Program files or installation identity changed. No private writing was removed.');app.quit();});}else if(!app.requestSingleInstanceLock()){app.quit();}else{
 let host;app.on('second-instance',()=>{if(host){host.window.restore();host.window.focus();}});
 startDesktop().then(h=>{host=h;}).catch(async()=>{await app.whenReady();dialog.showErrorBox('Siglum could not start / 无法启动','The writing service could not start. No workspace was migrated. Check the packaged runtime and dependencies.\n写作服务启动失败，没有迁移工作区。请核对运行时和依赖。');app.quit();});
}
