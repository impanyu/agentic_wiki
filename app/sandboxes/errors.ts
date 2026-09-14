export function sandboxMessage(error:unknown){
 const code=error instanceof Error?error.message:'';
 if(code==='OPENAI_SANDBOX_ACCESS_REQUIRED')return 'The OpenAI key needs Agents API and Responses API access to run this backend.';
 if(code==='OPENAI_SANDBOX_LIMIT')return 'OpenAI sandbox usage or rate limits were reached. Please try again later.';
 if(code==='OPENAI_SANDBOX_BUSY')return 'The OpenAI sandbox is still working. Please try again shortly.';
 if(code.startsWith('OPENAI_SANDBOX_'))return 'The OpenAI sandbox could not complete this backend. Your saved page is intact; please try again.';
 if(code==='SANDBOX_NOT_CONFIGURED')return 'Connect OpenAI to run this backend.';
 if(code==='SANDBOX_SIGN_IN_REQUIRED')return 'Sign in with an authorized account to run this backend.';
 if(code==='SANDBOX_DAILY_LIMIT'||code==='SANDBOX_CONCURRENCY_LIMIT')return 'Your sandbox execution limit has been reached. Please try again later.';
 return 'Invalid sandbox program or input.';
}
