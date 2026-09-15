export const GOOGLE_FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
export function isFileOnlyScope(scope:unknown){
 const scopes=typeof scope==='string'?scope.split(/\s+/):[];
 return scopes.includes(GOOGLE_FILE_SCOPE)&&!scopes.some(s=>s.startsWith('https://www.googleapis.com/auth/drive')&&s!==GOOGLE_FILE_SCOPE);
}
