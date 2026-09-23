// Per-tool presentation adapted from ADMA's own tool pages
// (templates/filemanager/*_tool.html): accent colors, intros, outputs and step flow.
import {Sprout,ArrowLeftRight,TrendingUp,BarChart3,Filter,type LucideIcon} from 'lucide-react';
export type ToolStep={title:string;help?:string;fields:string[]};
export type ToolInfo={Icon:LucideIcon;accent:string;gradient:string;subtitle:string;intro:string;outputs:[string,string][];steps:ToolStep[];runLabel:string;fieldHelp:Record<string,string>;accept:Record<string,string>};
export const toolInfo:Record<string,ToolInfo>={
 'seeding-tool':{Icon:Sprout,accent:'#8a6d00',gradient:'linear-gradient(135deg,#fff3cd,#ffeeba)',
  subtitle:'Process point shapefiles to create seeding polygons',
  intro:'This tool processes point-based seeding data from GPS and precision agriculture equipment.',
  outputs:[['Seeding Polygons','Buffered areas showing where products were applied'],['Boundary Shapefile','Auto-generated field boundary'],['Summary CSV','Area statistics by product']],
  steps:[{title:'Select input file',help:'Choose a point shapefile (.shp) or GeoPackage (.gpkg) containing seeding data.',fields:['file_id']},{title:'Select output folder',help:'Leave empty to auto-create a "seeding_tool_output" folder next to the input file.',fields:['output_dir_id']}],
  runLabel:'Run Seeding Tool',fieldHelp:{},accept:{file_id:'\\.(shp|gpkg)$'}},
 'shape-to-json':{Icon:ArrowLeftRight,accent:'#0b5ed7',gradient:'linear-gradient(135deg,#cfe2ff,#b6d4fe)',
  subtitle:'Convert shapefiles to GeoJSON format',
  intro:'This tool converts ESRI Shapefiles (.shp) to web-friendly GeoJSON, automatically reprojected to WGS84 (EPSG:4326).',
  outputs:[['GeoJSON File','Single standardized file that works natively with web mapping libraries']],
  steps:[{title:'Select input shapefile',help:'Choose a shapefile (.shp) to convert to GeoJSON.',fields:['file_id']},{title:'Select output folder',help:'Leave empty to auto-create a "geojson_output" folder next to the input file.',fields:['output_dir_id']}],
  runLabel:'Convert to GeoJSON',fieldHelp:{},accept:{file_id:'\\.shp$'}},
 'si-tool':{Icon:TrendingUp,accent:'#146c43',gradient:'linear-gradient(135deg,#d1e7dd,#badbcc)',
  subtitle:'Calculate Sufficiency Index values from buffer sectors and NDRE data',
  intro:'This tool evaluates crop nitrogen sufficiency by comparing NDRE values against reference values. Choose a treatment methodology and imagery type; the required inputs adjust to the selected workflow.',
  outputs:[['Updated CSV with SI','Your input CSV with computed Sufficiency Index values added']],
  steps:[{title:'Select workflow',fields:['workflow']},{title:'Parameters',fields:['field_column','si_column_name']},{title:'Select input files',fields:['buffer_shp_id','csv_file_id','ndre_shp_id','nir_tif_id','rededge_tif_id','indicator_shp_id']},{title:'Select output folder',help:'Leave empty to auto-create an "si_tool_output" folder next to the buffer sectors file.',fields:['output_folder_id']}],
  runLabel:'Calculate SI Values',fieldHelp:{field_column:'Column used for grouping fields; must exist in both the shapefile and the CSV.',si_column_name:'Column where SI values will be stored in the CSV (default: SI).'},accept:{buffer_shp_id:'\\.shp$',ndre_shp_id:'\\.shp$',indicator_shp_id:'\\.shp$',csv_file_id:'\\.csv$',nir_tif_id:'\\.tiff?$',rededge_tif_id:'\\.tiff?$'}},
 'yield-summary':{Icon:BarChart3,accent:'#087990',gradient:'linear-gradient(135deg,#d1ecf1,#bee5eb)',
  subtitle:'Analyze treatment sectors and yield data with statistical analysis',
  intro:'This tool processes treatment sector and yield shapefiles, runs ANOVA and computes economic metrics such as NUE, PFP and MNR.',
  outputs:[['Buffer Shapefile','Buffered treatment polygons for spatial analysis'],['Summary Shapefile','Merged spatial result with yield statistics'],['Summary Excel','Tabular summary of results'],['Statistics Excel','ANOVA analysis and treatment comparison (NUE, PFP, MNR)']],
  steps:[{title:'Select treatment sector shapefile',help:'Shapefile (.shp) with section_nu and Treatment columns.',fields:['treatment_file_id']},{title:'Select yield shapefile',help:'Shapefile (.shp) with Yield and Moisture columns.',fields:['yield_file_id']},{title:'Configure parameters',fields:['total_n_values','buffer_distance','corn_price','n_price']},{title:'Select output folder',help:'Leave empty to auto-create a "yield_summary_output" folder.',fields:['output_dir_id']}],
  runLabel:'Run Yield Summary Tool',fieldHelp:{total_n_values:'Comma-separated Total N values for active sectors in section order, e.g. 122,99.5,122,98.5.',buffer_distance:'Negative values create inward buffers. Default: -30 meters.',corn_price:'Corn price per bushel for economic calculations. Default: $4.35/bu.',n_price:'Nitrogen price per pound for economic calculations. Default: $0.50/lb N.'},accept:{treatment_file_id:'\\.shp$',yield_file_id:'\\.shp$'}},
 'valid-yield-extractor':{Icon:Filter,accent:'#997404',gradient:'linear-gradient(135deg,#fff3cd,#ffe69c)',
  subtitle:'Clean yield data by filtering harvest points to valid application areas',
  intro:'This tool processes treatment plots, as-applied data and harvest data to build Valid Application Areas, filter harvest points and output clean yield points.',
  outputs:[['Valid Application Area (VAA)','Areas where application rates match target rates'],['Valid Harvest Area (VHA)','Harvest points within valid application areas'],['Harvest Strips','Strip-level analysis of harvest data'],['Clean Yield Points','Filtered yield points for downstream analysis'],['Summary CSV','Tabular summary of results'],['Visualizations','PNG plots of the analysis']],
  steps:[{title:'Select treatment plots shapefile',fields:['plots_file_id']},{title:'Select as-applied data shapefile',fields:['app_file_id']},{title:'Select harvest data shapefile',fields:['harv_file_id']},{title:'Column mapping',help:'Optional; columns are auto-detected when left empty.',fields:['plot_id_col','target_rate_col','applied_rate_col','yield_col']},{title:'Configure parameters',fields:['crs','rate_tolerance']},{title:'Select output folder',help:'Leave empty to auto-create a "yield_cleaning_output" folder.',fields:['output_folder_id']}],
  runLabel:'Run Valid Yield Extractor',fieldHelp:{crs:'Projected CRS for spatial operations. Default: EPSG:26914 (UTM Zone 14N).',rate_tolerance:'Tolerance for matching application rates to target rates, between 0 and 1. Default: 0.10 (±10%).'},accept:{plots_file_id:'\\.shp$',app_file_id:'\\.shp$',harv_file_id:'\\.shp$'}},
};
// Mirrors the conditional SI validation in processing.ts: which fields are
// visible and required for the selected workflow.
export function siFieldState(workflow:string,name:string){
 const uav=workflow.endsWith('_uav'),sbf=workflow.startsWith('sbf_');
 if(name==='ndre_shp_id')return uav?'required':'hidden';
 if(name==='nir_tif_id'||name==='rededge_tif_id')return uav?'hidden':'required';
 if(name==='indicator_shp_id')return sbf?'required':'hidden';
 if(name==='field_column')return sbf?'hidden':'required';
 return 'default';
}
