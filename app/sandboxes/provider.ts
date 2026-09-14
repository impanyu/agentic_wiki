import {Sandbox} from 'e2b';
import {Sandbox as Desktop} from '@e2b/desktop';
import type {DesktopAction} from './contracts';
export const e2bProvider={
 async createDesktop(apiKey:string,internet:boolean){return Desktop.create({apiKey,timeoutMs:600000,secure:true,resolution:[1024,768],allowInternetAccess:internet,network:{allowPublicTraffic:false},envs:{}});},
 async connectDesktop(id:string,apiKey:string){return Desktop.connect(id,{apiKey});},
 async kill(id:string,apiKey:string){await Sandbox.kill(id,{apiKey});},
 async action(desktop:Desktop,action:DesktopAction){
  if(action.type==='click'){if(action.button==='right')await desktop.rightClick(action.x,action.y);else if(action.button==='double')await desktop.doubleClick(action.x,action.y);else await desktop.leftClick(action.x,action.y);}
  else if(action.type==='type')await desktop.write(action.text);
  else if(action.type==='press')await desktop.press(action.keys);
  else if(action.type==='scroll')await desktop.scroll(action.direction,action.amount);
  else if(action.type==='launch')await desktop.launch({browser:'google-chrome',editor:'mousepad',terminal:'xfce4-terminal'}[action.application]);
 },
};
