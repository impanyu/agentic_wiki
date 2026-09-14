'use client';
export type IndexEntry={question:string;description:string;group:string};
export function DisambiguationIndex({entries,onOpen,disabled}:{entries:IndexEntry[];onOpen:(question:string)=>void;disabled:boolean}){const groups=[...new Set(entries.map(e=>e.group))];return <div className="meaning-index">{groups.map(group=><section key={group}>{group&&<h2>{group}</h2>}<ul>{entries.filter(e=>e.group===group).map(e=><li key={e.question}><button disabled={disabled} onClick={()=>onOpen(e.question)}>{e.question}</button><p>{e.description}</p></li>)}</ul></section>)}</div>;}
