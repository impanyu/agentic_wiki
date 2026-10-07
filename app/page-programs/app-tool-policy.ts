import {connections} from '@/app/connectors/service';
import {connectorCatalog} from '@/app/connectors/catalog';
// Generated app code may use the platform's own tools, which act on the user's
// page, files and connected accounts. Tools that would contact a web address
// the app chooses are withheld, so app code cannot send data to a third party.
export const APP_TOOLS=new Set(['list_connectors','call_connector','browse_resources','copy_resources','storage_connections','storage_execute','list_page_files','read_uploaded_file','list_data_files','list_google_drive_folders','search_contexts','list_running_jobs','generate_image','plot_chart','render_plot','write_page_file','find_places','reverse_geocode','earth_engine','search_public_media','find_images','search_components','inspect_component','read_page_context','execute_code','suggest_page']);
export const WITHHELD_REASON:Record<string,string>={read_web_page:'opens a web address chosen by the app',import_image:'downloads from a web address chosen by the app',execute_api:'calls an external API',use_computer:'drives a web browser'};
const presetUrls=new Set(connectorCatalog.filter(p=>p.url).map(p=>p.url!.replace(/\/$/,'')));
export async function checkAppTool(userId:string,name:string,args:Record<string,unknown>){
 if(!APP_TOOLS.has(name))throw Error(`Apps cannot use ${name}`+(WITHHELD_REASON[name]?` (it ${WITHHELD_REASON[name]}); apps may only reach data through the platform's own tools.`:'.'));
 if(name==='call_connector'){
  const id=String(args.connectorId||''),c=(await connections(userId)).find(x=>x.id===id);
  if(c&&c.kind==='mcp'&&!presetUrls.has(String(c.url||'').replace(/\/$/,'')))throw Error('Apps cannot call custom connectors added by URL; they reach an outside server the platform does not provide.');
 }
}
