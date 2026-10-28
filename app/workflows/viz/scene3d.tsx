'use client';
import {useEffect,useRef,useState} from 'react';
import type * as T from 'three';
import type {VizProps} from './types';
import {colormap,colormapGradient} from './colormap';
import './scene3d.css';

const MAX_POINTS=200_000,MAX_SURFACE=600;
const PALETTE=['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#84cc16','#f97316','#64748b','#06b6d4'];
const num=(v:unknown)=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;
const arr=(v:unknown):any[]=>Array.isArray(v)?v:[];
const safeSrc=(s:unknown)=>typeof s==='string'&&(/^https:\/\//i.test(s)||(s.startsWith('/')&&!s.startsWith('//')));

// Cheap change signature: big arrays are sampled instead of fully serialised on every render.
function signature(p:Record<string,any>){
 const sample=(a:any[])=>{const n=a.length,s=Math.max(1,Math.floor(n/64)),o:any[]=[n];for(let i=0;i<n;i+=s)o.push(a[i]);if(n)o.push(a[n-1]);return o;};
 const {title,caption,height,...rest}=p;void title;void caption;void height;
 return JSON.stringify({...rest,points:sample(arr(p.points)),surface:p.surface&&{...p.surface,z:sample(arr(p.surface.z))}});
}
function niceTicks(a:number,b:number,n=5){
 const raw=(b-a)/n,p=10**Math.floor(Math.log10(raw)),e=raw/p,step=(e>=7.5?10:e>=3.5?5:e>=1.5?2:1)*p,out:number[]=[];
 for(let v=Math.ceil(a/step)*step;v<=b+step*1e-9&&out.length<20;v+=step)out.push(+v.toPrecision(12));
 return out;
}
const POINT_VS=`attribute vec3 aColor;attribute float aSize;uniform float uScale;varying vec3 vColor;
void main(){vColor=aColor;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=max(1.5,aSize*uScale/-mv.z);gl_Position=projectionMatrix*mv;}`;
// Soft round disc with a faint specular highlight; uRing draws the hover ring instead.
const POINT_FS=`uniform float uRing;varying vec3 vColor;
void main(){vec2 c=gl_PointCoord-.5;float d=length(c)*2.;if(d>1.)discard;
if(uRing>.5){float r=smoothstep(.62,.72,d)*(1.-smoothstep(.88,1.,d));if(r<.01)discard;gl_FragColor=vec4(vColor,r);return;}
float a=1.-smoothstep(.78,1.,d);float hl=1.-smoothstep(0.,.5,length(c-vec2(-.14,-.16))*2.);
gl_FragColor=vec4(vColor*(1.06-.2*d*d)+vec3(.16)*hl,a*.94);}`;

type Pick={datum:any;pos:T.Vector3;text:string};
type Legend={groups:[string,string][];bar?:{name:string;min:string;max:string;cmap:string}};

export default function Scene3D({props,setValue,fire,ctx}:VizProps){
 const hostRef=useRef<HTMLDivElement>(null),tipRef=useRef<HTMLDivElement>(null);
 const live=useRef({props,setValue,fire,ctx});live.current={props,setValue,fire,ctx};
 const [error,setError]=useState(''),[touched,setTouched]=useState(false),[legend,setLegend]=useState<Legend|null>(null);
 const t=(s:string)=>ctx?.t?ctx.t(s):s;
 const height=Math.max(160,num(props.height)||420);
 const transparent=!props.background||props.background==='transparent';
 const sig=signature(props);

 useEffect(()=>{
  const host=hostRef.current;if(!host)return;
  let dead=false;const undo:(()=>void)[]=[];
  setError('');setLegend(null);
  const tr=(s:string)=>live.current.ctx?.t?live.current.ctx.t(s):s;
  (async()=>{
   const p=live.current.props,locale=live.current.ctx?.locale||undefined;
   const [THREE,{OrbitControls},{CSS2DRenderer,CSS2DObject},{RoomEnvironment}]=await Promise.all([import('three'),import('three/examples/jsm/controls/OrbitControls.js'),import('three/examples/jsm/renderers/CSS2DRenderer.js'),import('three/examples/jsm/environments/RoomEnvironment.js')]);
   if(dead)return;
   const fmt=(v:number)=>Number.isFinite(v)?v.toLocaleString(locale,{maximumSignificantDigits:4,useGrouping:Math.abs(v)>=1e4}):'–';
   const colorCache=new Map<string,T.Color>();
   const parseColor=(c:unknown)=>{const k=String(c);let col=colorCache.get(k);if(!col){col=new THREE.Color();try{col.setStyle(k,THREE.SRGBColorSpace);}catch{col.set(PALETTE[0]);}colorCache.set(k,col);}return col;};

   // ---- parse data & bounds (data coordinates) ----
   const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   const ext=(x:number,y:number,z:number)=>{const v=[x,y,z];for(let i=0;i<3;i++){if(v[i]<lo[i])lo[i]=v[i];if(v[i]>hi[i])hi[i]=v[i];}};
   const pts:{x:number;y:number;z:number;d:any}[]=[];
   for(const d of arr(p.points)){if(pts.length>=MAX_POINTS)break;const x=num(Array.isArray(d)?d[0]:d?.x),y=num(Array.isArray(d)?d[1]:d?.y),z=num(Array.isArray(d)?d[2]:d?.z);if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)){pts.push({x,y,z,d});ext(x,y,z);}}
   let surf:{z:number[][];x:[number,number];y:[number,number];zmin:number;zmax:number;cmap:string;wire:boolean}|null=null;
   if(p.surface&&typeof p.surface==='object'){
    const rows0=arr(p.surface.z).filter(Array.isArray),sr=Math.ceil(rows0.length/MAX_SURFACE),cols0=Math.min(...rows0.map(r=>r.length)),sc=Math.ceil(cols0/MAX_SURFACE);
    const z=rows0.filter((_,i)=>i%sr===0).map(r=>(r as unknown[]).filter((_,j)=>j%sc===0&&j<cols0).map(num));
    if(z.length<2||z[0].length<2)throw Error(tr('The surface needs a z grid of at least 2×2 numbers.'));
    let zmin=Infinity,zmax=-Infinity;for(const r of z)for(const v of r)if(Number.isFinite(v)){zmin=Math.min(zmin,v);zmax=Math.max(zmax,v);}
    if(!Number.isFinite(zmin))throw Error(tr('The surface z grid has no numeric values.'));
    const range=(r:any,n:number):[number,number]=>Array.isArray(r)&&Number.isFinite(num(r[0]))&&Number.isFinite(num(r[1]))?[num(r[0]),num(r[1])]:[0,n-1];
    surf={z,x:range(p.surface.x,cols0),y:range(p.surface.y,rows0.length),zmin,zmax,cmap:String(p.surface.colormap||p.colormap||'viridis'),wire:!!p.surface.wireframe};
    ext(surf.x[0],surf.y[0],zmin);ext(surf.x[1],surf.y[1],zmax);
   }
   const lines=arr(p.lines).map(l=>({pts:arr(l?.points).map(q=>[num(q?.[0]),num(q?.[1]),num(q?.[2])]).filter(q=>q.every(Number.isFinite)),color:l?.color,d:l})).filter(l=>l.pts.length>1);
   for(const l of lines)for(const q of l.pts)ext(q[0],q[1],q[2]);
   // Bars: numeric x/y, or categories mapped to indices.
   const cats:(string[]|null)[]=[null,null];
   const barsRaw=arr(p.bars).filter(b=>b&&Number.isFinite(num(b.height)));
   const pos=(key:'x'|'y',i:0|1)=>{const vals=barsRaw.map(b=>b[key]);if(vals.every(v=>Number.isFinite(num(v))))return vals.map(num);const u=[...new Set(vals.map(String))];cats[i]=u;return vals.map(v=>u.indexOf(String(v)));};
   const bx=pos('x',0),by=pos('y',1);
   const minGap=(v:number[])=>{const u=[...new Set(v)].sort((a,b)=>a-b);let g=Infinity;for(let i=1;i<u.length;i++)g=Math.min(g,u[i]-u[i-1]);return Number.isFinite(g)?g:1;};
   const gx=minGap(bx),gy=minGap(by);
   barsRaw.forEach((b,i)=>{ext(bx[i]-gx/2,by[i]-gy/2,0);ext(bx[i]+gx/2,by[i]+gy/2,num(b.height));});
   const model=p.model&&typeof p.model==='object'?p.model:null;
   if(model&&!safeSrc(model.src))throw Error(tr('The 3D model address must start with https:// or /.'));
   const hasData=pts.length+lines.length+barsRaw.length>0||!!surf;
   if(!hasData&&!model)throw Error(tr('Nothing to show: provide points, a surface, lines, bars or a model.'));

   // ---- normalisation into a scene box (data z is up → three y) ----
   const span=[0,1,2].map(i=>{if(!hasData){lo[i]=-1;hi[i]=1;}if(hi[i]-lo[i]<=0){const pad=Math.abs(lo[i])*0.1||1;lo[i]-=pad;hi[i]+=pad;}return hi[i]-lo[i];});
   const aspect=p.aspect==='data'||p.aspect==='cube'?p.aspect:Math.max(...span)/Math.min(...span)<=3?'data':'cube';
   const half=aspect==='data'?span.map(s=>s/Math.max(...span)):[1,1,0.75];
   const N=(i:number,v:number)=>((v-lo[i])/span[i]*2-1)*half[i];
   const V=(x:number,y:number,z:number)=>new THREE.Vector3(N(0,x),N(2,z),-N(1,y));
   const cmapName=String(p.colormap||'viridis');
   const cm=(name:string,tt:number)=>{const [r,g,b]=colormap(name,tt);return new THREE.Color().setRGB(r,g,b,THREE.SRGBColorSpace);};

   // ---- renderer ----
   let renderer:T.WebGLRenderer;
   try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}
   catch{throw Error(tr('3D graphics (WebGL) are not available in this browser.'));}
   undo.push(()=>{renderer.setAnimationLoop(null);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();});
   renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
   renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
   renderer.setClearColor(0x000000,0);
   const labels=new CSS2DRenderer();labels.domElement.className='wf-s3d-labels';
   host.appendChild(renderer.domElement);host.appendChild(labels.domElement);undo.push(()=>labels.domElement.remove());
   const canvas=renderer.domElement;canvas.className='wf-s3d-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label',String(p.title||tr('3D scene')));
   const scene=new THREE.Scene();
   let dark=false;
   if(!(!p.background||p.background==='transparent')){const bg=parseColor(p.background).clone();scene.background=bg;dark=bg.getHSL({h:0,s:0,l:0}).l<0.35;}
   host.parentElement?.classList.toggle('is-dark',dark);
   const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,0.04).texture;
   room.dispose();scene.environment=env;scene.environmentIntensity=0.45;
   undo.push(()=>{scene.traverse((o:any)=>{o.geometry?.dispose?.();const m=o.material;for(const mm of Array.isArray(m)?m:m?[m]:[]){for(const k in mm)if(mm[k]?.isTexture)mm[k].dispose();mm.dispose();}});env.dispose();pmrem.dispose();});
   scene.add(new THREE.HemisphereLight(0xffffff,0xb6c2d4,0.9));
   const sun=new THREE.DirectionalLight(0xffffff,1.5);sun.position.set(2.5,4,3);scene.add(sun);
   const camera=new THREE.PerspectiveCamera(38,1,0.01,100);
   const content=new THREE.Group();scene.add(content);
   const pickables:T.Object3D[]=[];
   const pickInfo=new Map<T.Object3D,(h:T.Intersection)=>Pick|null>();
   const groups=new Map<string,string>();
   let bar:Legend['bar'];
   const ax={x:String(p.axisLabels?.x??'x'),y:String(p.axisLabels?.y??'y'),z:String(p.axisLabels?.z??'z')};
   const xyz=(x:number,y:number,z:number)=>`${ax.x}: ${fmt(x)}\n${ax.y}: ${fmt(y)}\n${ax.z}: ${fmt(z)}`;

   // ---- points ----
   let pointSize=0;const pointUniforms={uScale:{value:1}};
   const pointMat=(ring:boolean)=>new THREE.ShaderMaterial({vertexShader:POINT_VS,fragmentShader:POINT_FS,transparent:true,depthWrite:!ring,depthTest:!ring,uniforms:{uScale:pointUniforms.uScale,uRing:{value:ring?1:0}}});
   if(pts.length){
    const n=pts.length,P=new Float32Array(n*3),C=new Float32Array(n*3),S=new Float32Array(n);
    pointSize=Math.min(0.07,Math.max(0.014,0.3/Math.cbrt(n)));
    const sizes=pts.map(q=>num(q.d?.size)).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b),med=sizes[sizes.length>>1]||1;
    const byGroup=pts.some(q=>q.d?.group!=null);let byZ=false;
    pts.forEach((q,i)=>{
     const v=V(q.x,q.y,q.z);P.set([v.x,v.y,v.z],i*3);
     let col:T.Color|null=null;
     if(q.d?.color!=null)col=parseColor(q.d.color);
     else if(byGroup){const g=String(q.d?.group??'—');if(!groups.has(g))groups.set(g,PALETTE[groups.size%PALETTE.length]);col=parseColor(groups.get(g));}
     else{byZ=true;const [r,g,b]=colormap(cmapName,(q.z-lo[2])/span[2]);C.set([r,g,b],i*3);}
     if(col)C.set([col.r,col.g,col.b].map(c=>c<=0.0031308?c*12.92:1.055*c**(1/2.4)-0.055),i*3);// shader writes sRGB directly
     const s=num(q.d?.size);S[i]=pointSize*(Number.isFinite(s)&&s>0?Math.min(5,Math.max(0.2,s/med)):1);
    });
    if(byZ)bar={name:ax.z,min:fmt(lo[2]),max:fmt(hi[2]),cmap:cmapName};
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(P,3));geo.setAttribute('aColor',new THREE.BufferAttribute(C,3));geo.setAttribute('aSize',new THREE.BufferAttribute(S,1));
    const cloud=new THREE.Points(geo,pointMat(false));content.add(cloud);pickables.push(cloud);
    pickInfo.set(cloud,h=>{const q=h.index!=null?pts[h.index]:null;if(!q)return null;const lbl=q.d?.label!=null?String(q.d.label)+'\n':'';const g=q.d?.group!=null?`\n${q.d.group}`:'';return {datum:q.d,pos:V(q.x,q.y,q.z),text:lbl+xyz(q.x,q.y,q.z)+g};});
   }
   // ---- surface ----
   if(surf){
    const s=surf,R=s.z.length,Cn=s.z[0].length,geo=new THREE.PlaneGeometry(1,1,Cn-1,R-1),pa=geo.attributes.position as T.BufferAttribute,cols=new Float32Array(R*Cn*3);
    for(let i=0;i<R;i++)for(let j=0;j<Cn;j++){
     const k=i*Cn+j,zv=Number.isFinite(s.z[i][j])?s.z[i][j]:s.zmin,x=s.x[0]+(s.x[1]-s.x[0])*j/(Cn-1),y=s.y[0]+(s.y[1]-s.y[0])*i/(R-1),v=V(x,y,zv);
     pa.setXYZ(k,v.x,v.y,v.z);const c=cm(s.cmap,(zv-s.zmin)/(s.zmax-s.zmin||1));cols.set([c.r,c.g,c.b],k*3);
    }
    geo.setAttribute('color',new THREE.BufferAttribute(cols,3));geo.computeVertexNormals();geo.computeBoundingSphere();
    content.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.55,metalness:0.04,side:THREE.DoubleSide,flatShading:false})));
    if(s.wire){
     const seg:number[]=[],step=(n:number)=>Math.max(1,Math.round(n/40));
     for(let i=0;i<R;i+=step(R))for(let j=0;j<Cn-1;j++){seg.push(pa.getX(i*Cn+j),pa.getY(i*Cn+j)+0.002,pa.getZ(i*Cn+j),pa.getX(i*Cn+j+1),pa.getY(i*Cn+j+1)+0.002,pa.getZ(i*Cn+j+1));}
     for(let j=0;j<Cn;j+=step(Cn))for(let i=0;i<R-1;i++){seg.push(pa.getX(i*Cn+j),pa.getY(i*Cn+j)+0.002,pa.getZ(i*Cn+j),pa.getX((i+1)*Cn+j),pa.getY((i+1)*Cn+j)+0.002,pa.getZ((i+1)*Cn+j));}
     const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(seg,3));
     content.add(new THREE.LineSegments(wg,new THREE.LineBasicMaterial({color:0x0f172a,transparent:true,opacity:0.14})));
    }
    if(!bar)bar={name:ax.z,min:fmt(s.zmin),max:fmt(s.zmax),cmap:s.cmap};
   }
   // ---- lines ----
   lines.forEach((l,i)=>{const g=new THREE.BufferGeometry().setFromPoints(l.pts.map(q=>V(q[0],q[1],q[2])));content.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:l.color!=null?parseColor(l.color):parseColor(PALETTE[(i+(dark?1:0))%PALETTE.length]),transparent:true,opacity:0.95})));});
   // ---- bars ----
   if(barsRaw.length){
    const geo=new THREE.BoxGeometry(1,1,1);geo.translate(0,0.5,0);
    const mesh=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({roughness:0.42,metalness:0.05}),barsRaw.length);
    const w=Math.max(0.01,0.72*Math.min(gx*2*half[0]/span[0],gy*2*half[1]/span[1])),m=new THREE.Matrix4(),q=new THREE.Quaternion(),hs=barsRaw.map(b=>num(b.height)),hmin=Math.min(0,...hs),hmax=Math.max(...hs);
    const tops:T.Vector3[]=[];
    barsRaw.forEach((b,i)=>{
     const base=V(bx[i],by[i],0),top=V(bx[i],by[i],hs[i]),y0=Math.min(base.y,top.y),h=Math.max(1e-4,Math.abs(top.y-base.y));
     m.compose(new THREE.Vector3(base.x,y0,base.z),q,new THREE.Vector3(w,h,w));mesh.setMatrixAt(i,m);tops.push(top);
     mesh.setColorAt(i,b.color!=null?parseColor(b.color):cm(cmapName,(hs[i]-hmin)/(hmax-hmin||1)));
    });
    mesh.computeBoundingSphere();content.add(mesh);pickables.push(mesh);
    if(!bar&&barsRaw.some(b=>b.color==null))bar={name:ax.z,min:fmt(hmin),max:fmt(hmax),cmap:cmapName};
    const catName=(i:0|1,v:number)=>cats[i]?cats[i]![v]:fmt(v);
    pickInfo.set(mesh,h=>{const i=h.instanceId;if(i==null)return null;const b=barsRaw[i];return {datum:b,pos:tops[i],text:(b.label!=null?String(b.label)+'\n':'')+`${ax.x}: ${catName(0,bx[i])}\n${ax.y}: ${catName(1,by[i])}\n${ax.z}: ${fmt(hs[i])}`};});
   }
   // ---- axes: floor grid with nice ticks, three axis lines, CSS labels ----
   const showAxes=p.axes!=null?!!p.axes:pts.length>0||!!surf||barsRaw.length>0;
   const addLabel=(text:string,v:T.Vector3,cls:string)=>{const el=document.createElement('div');el.className=cls;el.textContent=text;const o=new CSS2DObject(el);o.position.copy(v);scene.add(o);};
   if(showAxes&&hasData){
    const fy=N(2,lo[2]),x0=N(0,lo[0]),x1=N(0,hi[0]),z0=-N(1,lo[1]),z1=-N(1,hi[1]),top=N(2,hi[2]),off=0.08;
    const tickVals=(i:0|1|2)=>{const c=i<2?cats[i]:null;if(c){const s=Math.ceil(c.length/8);return c.map((_,k)=>k).filter(k=>k%s===0);}if(i<2&&barsRaw.length&&!pts.length&&!surf&&!lines.length){const u=[...new Set(i?by:bx)].sort((a,b)=>a-b);if(u.length<=12)return u;}return niceTicks(lo[i],hi[i]);};
    const tickText=(i:0|1|2,v:number)=>{const c=i<2?cats[i]:null;return c?c[v]:fmt(v);};
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(x1-x0,z0-z1),new THREE.MeshBasicMaterial({color:dark?0x334155:0xe2e8f0,transparent:true,opacity:dark?0.25:0.35,depthWrite:false,side:THREE.DoubleSide}));
    floor.rotation.x=-Math.PI/2;floor.position.set((x0+x1)/2,fy-0.001,(z0+z1)/2);scene.add(floor);
    const grid:number[]=[];
    for(const v of tickVals(0)){const x=N(0,v);grid.push(x,fy,z0,x,fy,z1);addLabel(tickText(0,v),new THREE.Vector3(x,fy,z0+off),'wf-s3d-tick');}
    for(const v of tickVals(1)){const z=-N(1,v);grid.push(x0,fy,z,x1,fy,z);addLabel(tickText(1,v),new THREE.Vector3(x1+off,fy,z),'wf-s3d-tick');}
    for(const v of tickVals(2)){const y=N(2,v);grid.push(x0,y,z1,x0+0.04,y,z1);addLabel(tickText(2,v),new THREE.Vector3(x0-off,y,z1),'wf-s3d-tick');}
    const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(grid,3));
    scene.add(new THREE.LineSegments(gg,new THREE.LineBasicMaterial({color:dark?0x64748b:0x94a3b8,transparent:true,opacity:0.35})));
    const axg=new THREE.BufferGeometry();axg.setAttribute('position',new THREE.Float32BufferAttribute([x0,fy,z0,x1,fy,z0, x1,fy,z0,x1,fy,z1, x0,fy,z1,x0,top,z1],3));
    scene.add(new THREE.LineSegments(axg,new THREE.LineBasicMaterial({color:dark?0x94a3b8:0x475569,transparent:true,opacity:0.7})));
    addLabel(ax.x,new THREE.Vector3((x0+x1)/2,fy,z0+off*3),'wf-s3d-axis');
    addLabel(ax.y,new THREE.Vector3(x1+off*3.5,fy,(z0+z1)/2),'wf-s3d-axis');
    addLabel(ax.z,new THREE.Vector3(x0,top+off*1.6,z1),'wf-s3d-axis');
   }
   setLegend(groups.size||bar?{groups:groups.size<=12?[...groups]:[],bar}:null);

   // ---- camera framing ----
   const ring=new THREE.Points(new THREE.BufferGeometry(),pointMat(true));ring.visible=false;ring.renderOrder=10;
   ring.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3),3));ring.geometry.setAttribute('aColor',new THREE.BufferAttribute(new Float32Array([0.06,0.09,0.16]),3));ring.geometry.setAttribute('aSize',new THREE.BufferAttribute(new Float32Array(1),1));
   scene.add(ring);
   const controls=new OrbitControls(camera,canvas);undo.push(()=>controls.dispose());
   controls.enableDamping=true;controls.dampingFactor=0.08;controls.screenSpacePanning=true;
   const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   controls.autoRotate=p.autoRotate!==false&&!reduced;controls.enableZoom=false;controls.autoRotateSpeed=0.7;
   const frame=()=>{
    const box=new THREE.Box3().setFromObject(content);
    if(hasData)box.union(new THREE.Box3(new THREE.Vector3(-half[0],-half[2],-half[1]),new THREE.Vector3(half[0],half[2],half[1])));
    const sphere=box.getBoundingSphere(new THREE.Sphere());
    const r=Math.max(0.2,sphere.radius),dist=r/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.02;
    const cp=arr(p.cameraPosition).map(num);
    const dir=cp.length===3&&cp.every(Number.isFinite)?(hasData?V(cp[0],cp[1],cp[2]):new THREE.Vector3(cp[0],cp[2],-cp[1])).sub(sphere.center).normalize():new THREE.Vector3(1.15,0.8,1.35).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir,dist);camera.near=dist/100;camera.far=dist*20;camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);controls.minDistance=r*0.25;controls.maxDistance=r*8;controls.update();controls.saveState();
   };
   frame();

   // ---- model ----
   if(model){
    const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js');if(dead)return;
    new GLTFLoader().loadAsync(String(model.src)).then(gltf=>{
     const obj=gltf.scene;if(dead){obj.traverse((o:any)=>{o.geometry?.dispose?.();});return;}
     const box=new THREE.Box3().setFromObject(obj),size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3()),k=2/Math.max(size.x,size.y,size.z,1e-6);
     obj.scale.setScalar(k);obj.position.copy(c).multiplyScalar(-k);content.add(obj);if(!hasData)frame();
    }).catch(()=>{if(!dead)setError(tr('The 3D model could not be loaded.'));});
   }

   // ---- sizing, visibility, render loop ----
   const resize=()=>{const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);renderer.setSize(w,h,false);labels.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();pointUniforms.uScale.value=h*renderer.getPixelRatio()/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));};
   resize();
   const ro=new ResizeObserver(resize);ro.observe(host);undo.push(()=>ro.disconnect());
   const ray=new THREE.Raycaster();ray.params.Points.threshold=Math.max(0.01,pointSize*0.6);
   let pointer:{x:number;y:number}|null=null,dirty=false,dragging=false,current:Pick|null=null;
   const pickAt=(x:number,y:number):Pick|null=>{
    if(!pickables.length)return null;
    ray.setFromCamera(new THREE.Vector2(x/canvas.clientWidth*2-1,-(y/canvas.clientHeight)*2+1),camera);
    const h=ray.intersectObjects(pickables,false)[0];return h?pickInfo.get(h.object)?.(h)??null:null;
   };
   const showTip=(hit:Pick|null)=>{
    const tip=tipRef.current;current=hit;canvas.style.cursor=hit?'pointer':'';ring.visible=!!hit;
    if(!tip)return;if(!hit||!pointer){tip.hidden=true;return;}
    (ring.geometry.attributes.position as T.BufferAttribute).setXYZ(0,hit.pos.x,hit.pos.y,hit.pos.z);ring.geometry.attributes.position.needsUpdate=true;
    (ring.geometry.attributes.aSize as T.BufferAttribute).setX(0,Math.max(pointSize*2.4,0.06));ring.geometry.attributes.aSize.needsUpdate=true;ring.geometry.computeBoundingSphere();
    tip.textContent=hit.text;tip.hidden=false;
    const w=tip.offsetWidth,h=tip.offsetHeight,W=host.clientWidth,H=host.clientHeight;
    tip.style.left=`${pointer.x+14+w>W?pointer.x-14-w:pointer.x+14}px`;tip.style.top=`${Math.min(H-h-6,Math.max(6,pointer.y+14))}px`;
   };
   const local=(e:PointerEvent)=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
   let down:{x:number;y:number}|null=null;
   const onMove=(e:PointerEvent)=>{pointer=local(e);dirty=true;};
   // Wheel-zoom only once the scene has been clicked, so scrolling the article is never hijacked.
   const onLeave=()=>{pointer=null;showTip(null);if(!dragging)controls.enableZoom=false;};
   const onDown=(e:PointerEvent)=>{down=local(e);controls.enableZoom=true;};
   const onUp=(e:PointerEvent)=>{const u=local(e);if(down&&Math.hypot(u.x-down.x,u.y-down.y)<5){const hit=pickAt(u.x,u.y);if(hit){live.current.setValue(hit.datum);live.current.fire('select',hit.datum);}}down=null;};
   const onDbl=()=>controls.reset();
   const onStart=()=>{dragging=true;controls.autoRotate=false;setTouched(true);showTip(null);};
   const onEnd=()=>{dragging=false;};
   canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerleave',onLeave);canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('dblclick',onDbl);
   controls.addEventListener('start',onStart);controls.addEventListener('end',onEnd);
   undo.push(()=>{canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerleave',onLeave);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('dblclick',onDbl);controls.removeEventListener('start',onStart);controls.removeEventListener('end',onEnd);});
   const tick=()=>{
    controls.update();
    // Raycast at most once per frame, and only after the pointer moved.
    if(dirty&&!dragging&&pointer){dirty=false;const hit=pickAt(pointer.x,pointer.y);if(hit||current)showTip(hit);}
    renderer.render(scene,camera);labels.render(scene,camera);
   };
   const io=new IntersectionObserver(([e])=>renderer.setAnimationLoop(e?.isIntersecting?tick:null));io.observe(host);undo.push(()=>io.disconnect());
   tick();
  })().catch(e=>{if(!dead){setError(e instanceof Error?e.message:String(e));while(undo.length)try{undo.pop()!();}catch{}}});
  return ()=>{dead=true;while(undo.length)try{undo.pop()!();}catch{/* already gone */}};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[sig]);

 return <figure className="wf-viz wf-scene3d">
  {props.title&&<header className="wf-viz-title">{String(props.title)}</header>}
  <div className={'wf-s3d-stage'+(transparent?' is-transparent':'')} style={{height,background:transparent?undefined:String(props.background)}}>
   <div ref={hostRef} className="wf-s3d-host" onPointerDown={()=>setTouched(true)}/>
   <div ref={tipRef} className="wf-s3d-tip" hidden role="tooltip"/>
   {legend&&!error&&<div className="wf-s3d-legend">
    {legend.groups.map(([g,c])=><span key={g}><i style={{background:c}}/>{g}</span>)}
    {legend.bar&&<div className="wf-s3d-colorbar" title={legend.bar.name}><b>{legend.bar.max}</b><i style={{background:colormapGradient(legend.bar.cmap)}}/><b>{legend.bar.min}</b></div>}
   </div>}
   {!error&&<div className={'wf-s3d-hint'+(touched?' is-hidden':'')} aria-hidden>{t('Drag to rotate · Click, then scroll to zoom')}</div>}
   {error&&<div className="wf-viz-error" role="alert">{error}</div>}
  </div>
  {props.caption&&<figcaption className="wf-viz-caption">{String(props.caption)}</figcaption>}
 </figure>;
}
