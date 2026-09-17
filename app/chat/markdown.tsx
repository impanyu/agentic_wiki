'use client';
import {pageLinkQuestion} from './page-link';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatMarkdown({text,onOpenQuestion}:{text:string;onOpenQuestion?:(question:string)=>void}){
 return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
  a:({children,href})=>{const question=pageLinkQuestion(href);return question?<a className="chat-page-link" href={href} onClick={e=>{if(onOpenQuestion&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();onOpenQuestion(question);}}}>{children} ↗</a>:<a href={href} target={href?.startsWith('/?page=')?undefined:'_blank'} rel="noopener noreferrer">{children}</a>;},
 }}>{text}</Markdown></div>;
}
