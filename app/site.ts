// The deployment's public address comes from APP_URL (see .env.example); nothing
// in the code names a particular site.
export const siteUrl=()=>(process.env.APP_URL||'').replace(/\/$/,'');
// Identifies outbound requests to services that ask for a contact URL (OpenStreetMap, Wikimedia, tile hosts).
export const userAgent=()=>'AgenticWiKi/1.0'+(siteUrl()?' (+'+siteUrl()+')':' (+https://github.com/impanyu/agentic_wiki)');
