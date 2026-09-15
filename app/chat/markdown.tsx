'use client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatMarkdown({text}:{text:string}){
 return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
  a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
 }}>{text}</Markdown></div>;
}
