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
// The crawlable page's view of its rankings: the criterion in the address (?rank=, read on the
// server so the HTML is already sorted by it), the address of each criterion's view (so the
// column headers are real links), and each ranking chart pre-rendered as SVG (by chartKey).
// onRank: the reader page follows a criterion switch (its title names the criterion).
// period/onPeriod: the period in the address (?year=) and the reader's switch to another.
export type RankingViewValue={rank?:string;rankHref?:(key:string)=>string;charts?:Record<string,string>;onRank?:(key:string)=>void;period?:string;onPeriod?:(period:string)=>void};
export const RankingView=createContext<RankingViewValue>({});
export const useRankingView=()=>useContext(RankingView);
