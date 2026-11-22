import {generateMetadata as meta,TopicPage} from '../topic-page';
// /topics/<slug>: the stable address of a topic; it redirects to the topic's place in the address tree.
export const dynamic='force-dynamic';
type Props={params:Promise<{slug:string}>};
export const generateMetadata=(p:Props)=>meta(p);
export default function Page(p:Props){return TopicPage({...p,legacy:true});}
