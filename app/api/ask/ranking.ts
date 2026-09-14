// Keep five question records, even when several map to the same page.
export function nearestQuestions<T extends {id:string;score:number}>(candidates:T[]):T[]{
 return [...candidates].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,5);
}
