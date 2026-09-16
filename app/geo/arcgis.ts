let pending:Promise<(paths:string[])=>Promise<any[]>>|undefined;
export function loadArcGIS(){
 if(pending)return pending;
 pending=new Promise((resolve,reject)=>{
  const css=document.createElement('link');css.rel='stylesheet';css.href='https://js.arcgis.com/5.1/esri/themes/light/main.css';css.dataset.geoSdk='true';document.head.appendChild(css);
  const script=document.createElement('script');script.type='module';script.src='https://js.arcgis.com/5.1/';
  const timer=setTimeout(()=>{script.remove();css.remove();pending=undefined;reject(Error('Map engine timed out. Reload to retry.'));},30000);
  script.onload=()=>{clearTimeout(timer);const api=(window as any).$arcgis;if(!api){pending=undefined;reject(Error('Map engine unavailable.'));return;}resolve(paths=>api.import(paths));};
  script.onerror=()=>{clearTimeout(timer);script.remove();css.remove();pending=undefined;reject(Error('Could not load the ArcGIS map engine.'));};document.head.appendChild(script);
 });return pending;
}
