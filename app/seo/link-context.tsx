'use client';
import {createContext,useContext} from 'react';
import {askPath,questionKey} from './urls';
// Where a "/?ask=<question>" link should point. On the server-rendered page (/p/…) questions that
// already have a page are resolved to its canonical address, so search engines follow real pages;
// the others keep /?ask= (which generates a page) with rel="nofollow", and robots.txt keeps
// crawlers out of /?ask= so no crawler ever triggers generation.
export const AskTargets=createContext<Record<string,string>|null>(null);
export function useAskLink(){
 const targets=useContext(AskTargets);
 return (question:string)=>{const href=targets?.[questionKey(question)];return href?{href,rel:undefined}:{href:askPath(question),rel:'nofollow'};};
}
