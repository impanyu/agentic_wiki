import {generateMetadata as meta,EntityPage} from '../../entity-page';
// /e/<type>/<slug>: the stable address of an entity. It redirects to the entity's place in the address tree
// (/<topic>/…/<slug>) and serves entities of types that have no topic yet.
export const dynamic='force-dynamic';
type Props={params:Promise<{type:string;slug:string}>};
export const generateMetadata=(p:Props)=>meta(p);
export default function Page(p:Props){return EntityPage({...p,legacy:true});}
