import Workspace from './workspace';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home(){ const user = await getChatGPTUser(); return <Workspace user={user ? {name:user.displayName,id:user.userId}:null} signIn={chatGPTSignInPath('/')} signOut={chatGPTSignOutPath('/')} />; }
