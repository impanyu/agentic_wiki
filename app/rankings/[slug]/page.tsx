import {generateMetadata as meta,RankingPage} from '../ranking-page';
// /rankings/<slug>: the stable address of a ranking. It redirects to the ranking's place in the address tree
// (/<topic>/…/<slug>) and serves rankings that have no topic yet.
export const dynamic='force-dynamic';
type Props={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export const generateMetadata=(p:Props)=>meta(p);
export default function Page(p:Props){return RankingPage({...p,legacy:true});}
