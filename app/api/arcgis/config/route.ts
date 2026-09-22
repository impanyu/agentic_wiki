export async function GET(){return Response.json({clientId:process.env.ARCGIS_CLIENT_ID||'',portal:process.env.ARCGIS_PORTAL_URL||'https://universityofne.maps.arcgis.com'});}
