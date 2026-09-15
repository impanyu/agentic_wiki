import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {TableKit} from '@tiptap/extension-table';
import {Node} from '@tiptap/core';
import {safeRichUrl} from './document';
import {videoEmbedUrl} from '@/app/url-content/media';
const Video=Node.create({name:'video',group:'block',atom:true,draggable:true,
 addAttributes(){return {src:{default:''},title:{default:''},embed:{default:false,parseHTML:element=>element.tagName==='IFRAME'}};},
 parseHTML(){return [{tag:'video[src]'},{tag:'iframe[src]',getAttrs:element=>videoEmbedUrl((element as HTMLElement).getAttribute('src')||'')?{}:false}];},
 renderHTML({node}){const src=safeRichUrl(node.attrs.src,true);return node.attrs.embed?['iframe',{src:src?videoEmbedUrl(src):undefined,title:node.attrs.title,sandbox:'allow-scripts allow-same-origin allow-presentation',referrerpolicy:'no-referrer',allowfullscreen:'true'}]:['video',{src:src||undefined,controls:'',preload:'none',title:node.attrs.title}];}
});
export const editorExtensions=[StarterKit.configure({heading:{levels:[1,2,3]},link:{openOnClick:false,isAllowedUri:url=>!!safeRichUrl(url)}}),Image.configure({allowBase64:false}),Video,TableKit];
