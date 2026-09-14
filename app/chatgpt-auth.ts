// Compatibility names for existing callers; identity now comes from our own
// server-side Google OAuth session, never from client-supplied proxy headers.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionCookie, sessionUser, type User } from '@/server/auth';
export type ChatGPTUser = User;
export async function getChatGPTUser() { return sessionUser((await cookies()).get(sessionCookie)?.value || ''); }
export async function requireChatGPTUser(returnTo: string) { const user = await getChatGPTUser(); if (user) return user; redirect(chatGPTSignInPath(returnTo)); }
export function chatGPTSignInPath(returnTo: string) { return '/auth/google?return_to=' + encodeURIComponent(returnTo); }
export function chatGPTSignOutPath(_returnTo = '/') { return '/auth/signout'; }
