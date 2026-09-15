export const GOOGLE_FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const GOOGLE_READ_SCOPE='https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_DRIVE_SCOPES=GOOGLE_READ_SCOPE+' '+GOOGLE_FILE_SCOPE;
export function hasGoogleDriveScopes(scope:unknown){
 const scopes=typeof scope==='string'?scope.split(/\s+/):[];
 return scopes.includes(GOOGLE_FILE_SCOPE)&&scopes.includes(GOOGLE_READ_SCOPE)&&!scopes.some(s=>s.startsWith('https://www.googleapis.com/auth/drive')&&s!==GOOGLE_FILE_SCOPE&&s!==GOOGLE_READ_SCOPE);
}
