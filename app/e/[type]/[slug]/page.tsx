import {generateMetadata as meta,EntityPage} from '../../entity-page';
// /e/<num>/<slug>: an entity's page by its permanent number (the slug follows its name; another spelling
// redirects). /e/<type>/<slug>, the older form, redirects to it.
export const dynamic='force-dynamic';
type Props={params:Promise<{type:string;slug:string}>};
export const generateMetadata=(p:Props)=>meta(p);
export default function Page(p:Props){return EntityPage(p);}
