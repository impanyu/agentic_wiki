import type {Metadata} from 'next';
import {localePath,languageAlternates,DEFAULT_LOCALE} from './locales';
// Search metadata of a page in a language edition. Page content is still written in English, so the other
// editions translate only the interface: they are left out of search indexes (noindex, follow) and carry no
// hreflang until content is translated too — then CONTENT_TRANSLATED turns both on.
export const CONTENT_TRANSLATED=false;
// complete: the page's own content is translated into this language (localizeContent) — then that edition is
// indexed and the page lists its language versions.
export function localeMeta(path:string,locale:string,complete=false):Pick<Metadata,'alternates'|'robots'>{
 const indexed=locale===DEFAULT_LOCALE||CONTENT_TRANSLATED||complete;
 return {alternates:{canonical:localePath(path,locale),...(CONTENT_TRANSLATED||complete?{languages:languageAlternates(path)}:{})},
  robots:indexed?{index:true,follow:true}:{index:false,follow:true}};
}
