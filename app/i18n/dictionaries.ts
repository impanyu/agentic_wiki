// Interface strings of the public pages in every site language (app/i18n/public/<code>.json; keys are the
// English text). scripts/i18n/extract-public.mjs lists the keys; a test checks every language has them all.
import en from './public/en.json';
import zh from './public/zh.json';import es from './public/es.json';import fr from './public/fr.json';import de from './public/de.json';
import ja from './public/ja.json';import ko from './public/ko.json';import ru from './public/ru.json';import pt from './public/pt.json';
import ar from './public/ar.json';import hi from './public/hi.json';import it from './public/it.json';import id from './public/id.json';
import tr from './public/tr.json';import vi from './public/vi.json';import pl from './public/pl.json';
const ALL:Record<string,Record<string,string>>={en,zh,es,fr,de,ja,ko,ru,pt,ar,hi,it,id,tr,vi,pl};
export const PUBLIC_KEYS=Object.keys(en);
export function dictionary(locale:string):Record<string,string>{return ALL[locale]??{};}
export function translate(dict:Record<string,string>,text:string,values?:Record<string,string|number>):string{
 return (dict[text]||text).replace(/\{(\w+)\}/g,(m,k)=>String(values?.[k]??m));
}
